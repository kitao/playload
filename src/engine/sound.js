// ZX 128 PLAY notation. Channel selection is supplied by play(ch, str).
export function compileScore(source) {
  if (source.length > 65536) throw new RangeError('Score is too long');
  const code = [],
    openings = [];
  const beats = [0, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4, 1 / 6, 1 / 3, 2 / 3];
  let i = 0,
    duration = 5,
    tie = 0,
    triplet = 0,
    previous = 5,
    octave = 5,
    accidental = 0;
  let unmatched = -1,
    unmatchedClosing = 0;
  const number = (minimum, maximum) => {
    const start = i;
    while (/\d/.test(source[i] ?? '')) i++;
    const n = Number(source.slice(start, i));
    if (i === start || n < minimum || n > maximum)
      throw new SyntaxError(`Invalid score number at ${start + 1}`);
    return n;
  };
  const repeat = (start, count) => {
    if (!code.slice(start).some((event) => event.op === 'note')) {
      if (count === 0) throw new SyntaxError('A loop needs a note or rest');
      return -1;
    }
    return code.push({ op: 'repeat', start, count }) - 1;
  };
  while (i < source.length) {
    const c = source[i++];
    if (/\s/.test(c) || c === 'N') continue;
    if (c === '!') {
      const end = source.indexOf('!', i);
      if (end === -1) throw new SyntaxError('Unclosed score comment');
      i = end + 1;
      continue;
    }
    if (/\d/.test(c)) {
      i--;
      const n = number(1, 12);
      if (n >= 10) {
        previous = duration;
        triplet = 3;
      }
      duration = n;
      continue;
    }
    if (c === '_') {
      tie += beats[duration];
      continue;
    }
    if (c === '#') {
      accidental++;
      continue;
    }
    if (c === '$') {
      accidental--;
      continue;
    }
    if (c === '(') {
      openings.push(code.length);
      continue;
    }
    if (c === ')') {
      if (openings.length) repeat(openings.pop(), 2);
      else if (++unmatchedClosing >= 2) {
        if (unmatched < 0) throw new SyntaxError('A loop needs a note or rest');
        code[unmatched].count = 0;
      } else unmatched = repeat(0, 2);
      continue;
    }
    if (c === 'O') {
      octave = number(0, 8);
      continue;
    }
    if ('VWXTM'.includes(c)) {
      const ranges = { V: [0, 15], W: [0, 7], X: [0, 65535], T: [60, 240], M: [1, 63] };
      code.push({ op: c, value: number(...ranges[c]) });
      continue;
    }
    if (c === 'U' || c === 'H') {
      code.push({ op: c });
      continue;
    }
    if (c === '&' || /[a-g]/i.test(c)) {
      const semitone = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[c.toLowerCase()];
      // Spectrum O5 puts lower-case c at middle C (MIDI 60).
      const midi = octave * 12 + semitone + (c !== c.toLowerCase() ? 12 : 0) + accidental;
      code.push({
        op: 'note',
        frequency: c === '&' ? 0 : 440 * 2 ** ((midi - 69) / 12),
        beats: beats[duration] + tie,
      });
      accidental = tie = 0;
      if (triplet && --triplet === 0) duration = previous;
      continue;
    }
    throw new SyntaxError(`Unknown score command ${c} at ${i}`);
  }
  while (openings.length) repeat(openings.pop(), 2);
  if (tie || accidental) throw new SyntaxError('Incomplete score note');
  if (code.length > 16384) throw new RangeError('Score has too many commands');
  return { code, fixedVolume: code.some((event) => event.op === 'V') };
}

// Three square-wave channels, shared 17-bit noise, shared 16-step envelope.
// Eight-times oversampling and a windowed-sinc output filter cover the whole mix.
export class AY {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.clock = 1773400;
    this.oversample = 8;
    this.dcDecay = Math.exp((-2 * Math.PI * 20) / sampleRate);
    // Matthew Westcott's public-domain AY measurements (2001), with DC removed.
    const volts = [
      1.147, 1.162, 1.169, 1.178, 1.192, 1.213, 1.238, 1.299, 1.336, 1.457, 1.573, 1.707, 1.882,
      2.06, 2.32, 2.58,
    ];
    this.levels = volts.map((value) => (value - volts[0]) / (volts[15] - volts[0]));
    this.kernel = new Float64Array(257);
    const cutoff = 0.4 / this.oversample,
      middle = (this.kernel.length - 1) / 2;
    let sum = 0;
    for (let i = 0; i < this.kernel.length; i++) {
      const t = i - middle,
        angle = (2 * Math.PI * i) / (this.kernel.length - 1);
      const window = 0.42 - 0.5 * Math.cos(angle) + 0.08 * Math.cos(2 * angle);
      this.kernel[i] =
        (t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t)) * window;
      sum += this.kernel[i];
    }
    for (let i = 0; i < this.kernel.length; i++) this.kernel[i] /= sum;
    this.history = new Float64Array(this.kernel.length * 2);
    this.reset();
  }
  reset() {
    this.voices = [null, null, null];
    this.phase = [0, 0, 0];
    this.toneCounter = [0, 0, 0];
    this.toneHigh = [true, true, true];
    this.period = [1, 1, 1];
    this.mixer = 7;
    this.tempo = 120;
    this.noise = 0x1ffff;
    this.noisePhase = 0;
    this.noisePeriod = 1;
    this.envelopePeriod = 65535;
    this.shape = 0;
    this.trigger();
    this.lastInput = this.lastOutput = 0;
    this.history.fill(0);
    this.position = 0;
  }
  trigger() {
    this.envelopePhase = 0;
    this.envelopeStep = 0;
    this.attack = !!(this.shape & 4);
    this.envelopeHeld = false;
    this.envelopeLevel = this.attack ? 0 : 15;
  }
  play(ch, program) {
    this.voices[ch] = program.code.length
      ? {
          program,
          pc: 0,
          loops: new Map(),
          remaining: 0,
          volume: 15,
          envelope: false,
          sounding: false,
        }
      : null;
  }
  next(ch, voice) {
    let budget = 32768;
    while (voice.pc < voice.program.code.length) {
      if (--budget === 0) throw new Error('Score loop did not advance');
      const event = voice.program.code[voice.pc++];
      switch (event.op) {
        case 'repeat': {
          const position = voice.pc - 1;
          const count = voice.loops.get(position) ?? event.count - 1;
          if (event.count === 0 || count > 0) {
            voice.loops.set(position, count - 1);
            voice.pc = event.start;
          } else voice.loops.delete(position);
          break;
        }
        case 'T':
          if (ch === 0) this.tempo = event.value;
          break;
        case 'M':
          this.mixer = event.value;
          break;
        case 'V':
          voice.volume = event.value;
          voice.envelope = false;
          break;
        case 'W':
          this.shape = [0, 4, 9, 13, 8, 12, 14, 10][event.value];
          break;
        case 'X':
          this.envelopePeriod = Math.max(0.5, event.value);
          break;
        case 'U':
          voice.envelope = !voice.program.fixedVolume;
          break;
        case 'H':
          this.voices.fill(null);
          return;
        case 'note':
          voice.remaining += event.beats;
          voice.sounding = event.frequency > 0;
          if (voice.sounding) {
            this.setPeriod(
              ch,
              Math.max(1, Math.min(4095, Math.round(this.clock / (16 * event.frequency)))),
            );
            if (this.mixer & (8 << ch)) this.noisePeriod = Math.max(1, this.period[ch] & 31);
            if (voice.envelope) this.trigger();
          }
          return;
      }
    }
    this.voices[ch] = null;
  }
  setPeriod(ch, period) {
    // The hardware keeps its half-cycle counter and output bit across a write.
    // Re-express them at the new period without changing the output polarity.
    this.period[ch] = period;
    this.phase[ch] = this.toneCounter[ch] + (this.toneHigh[ch] ? 0 : 8 * period);
  }
  // PolyBLEP smooths square-wave edges to reduce harmonics folding below Nyquist.
  edge(phase, step) {
    if (phase < step) {
      const t = phase / step;
      return 2 * t - t * t - 1;
    }
    if (phase > 1 - step) {
      const t = (phase - 1) / step;
      return t * t + 2 * t + 1;
    }
    return 0;
  }
  tone(ch) {
    const step = this.clock / (16 * this.period[ch] * this.sampleRate * this.oversample),
      phase = this.phase[ch] / (16 * this.period[ch]);
    if (step * this.oversample >= 0.5) return 0.5;
    return (
      (phase < 0.5 ? 1 : 0) + 0.5 * (this.edge(phase, step) - this.edge((phase + 0.5) % 1, step))
    );
  }
  synth() {
    const rate = this.sampleRate * this.oversample;
    // Count master clocks, rather than accumulating rounded fractions of a
    // period. Period writes preserve the half-cycle counter and polarity; clock-grid
    // comparisons with a reference PSG do not slip at non-power-of-two periods.
    const clocks = this.clock / rate;
    for (let ch = 0; ch < 3; ch++) {
      const half = 8 * this.period[ch],
        elapsed = this.toneCounter[ch] + clocks;
      const edges = Math.floor(elapsed / half);
      this.toneCounter[ch] = elapsed % half;
      if (edges % 2) this.toneHigh[ch] = !this.toneHigh[ch];
      this.phase[ch] = this.toneCounter[ch] + (this.toneHigh[ch] ? 0 : half);
    }
    this.noisePhase += clocks;
    while (this.noisePhase >= 16 * this.noisePeriod) {
      this.noisePhase -= 16 * this.noisePeriod;
      this.noise = (this.noise >>> 1) | (((this.noise ^ (this.noise >>> 3)) & 1) << 16);
    }
    this.envelopePhase += clocks;
    while (this.envelopePhase >= 16 * this.envelopePeriod) {
      this.envelopePhase -= 16 * this.envelopePeriod;
      if (this.envelopeHeld) continue;
      this.envelopeStep++;
      if (this.envelopeStep === 16) {
        if (!(this.shape & 8)) {
          this.envelopeHeld = true;
          this.envelopeLevel = 0;
          continue;
        }
        if (this.shape & 1) {
          this.envelopeHeld = true;
          this.envelopeLevel = this.shape & 2 ? (this.attack ? 0 : 15) : this.attack ? 15 : 0;
          continue;
        }
        if (this.shape & 2) this.attack = !this.attack;
        this.envelopeStep = 0;
      }
      this.envelopeLevel = this.attack ? this.envelopeStep : 15 - this.envelopeStep;
    }
    let sum = 0;
    for (let ch = 0; ch < 3; ch++) {
      const voice = this.voices[ch];
      if (!voice?.sounding) continue;
      const tone = this.mixer & (1 << ch) ? this.tone(ch) : 1;
      const noise = !(this.mixer & (8 << ch)) || this.noise & 1;
      if (noise) sum += tone * this.levels[voice.envelope ? this.envelopeLevel : voice.volume];
    }
    // Fixed DAC gain leaves headroom for three voices; author loudness with V.
    return sum * 0.2;
  }
  sample() {
    for (let ch = 0; ch < 3; ch++) {
      const voice = this.voices[ch];
      if (voice && voice.remaining <= 0) this.next(ch, voice);
      if (this.voices[ch]) this.voices[ch].remaining -= this.tempo / (60 * this.sampleRate);
    }
    const length = this.kernel.length;
    for (let i = 0; i < this.oversample; i++) {
      const value = this.synth();
      this.history[this.position] = this.history[this.position + length] = value;
      this.position = (this.position + 1) % length;
    }
    // Duplicated history avoids wrapping in this hot loop. The kernel is symmetric.
    let input = this.kernel[(length - 1) / 2] * this.history[this.position + (length - 1) / 2];
    for (let i = 0; i < (length - 1) / 2; i++) {
      input +=
        this.kernel[i] *
        (this.history[this.position + i] + this.history[this.position + length - 1 - i]);
    }
    const output = input - this.lastInput + this.dcDecay * this.lastOutput;
    this.lastInput = input;
    this.lastOutput = output;
    return output;
  }
  render(length) {
    return Float32Array.from({ length }, () => this.sample());
  }
}
