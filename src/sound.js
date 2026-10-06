// ZX 128 PLAY notation. Channel selection is supplied by play(ch, score).
export function compileScore(source) {
  if (source.length > 65536) throw new RangeError('Score is too long');
  const code = [], openings = [];
  const beats = [0, .25, .375, .5, .75, 1, 1.5, 2, 3, 4, 1 / 6, 1 / 3, 2 / 3];
  let i = 0, duration = 5, tie = 0, triplet = 0, previous = 5, octave = 5, accidental = 0;
  let unmatched = -1, unmatchedClosing = 0;
  const number = (minimum, maximum) => {
    const start = i;
    while (/\d/.test(source[i] ?? '')) i++;
    const n = Number(source.slice(start, i));
    if (i === start || n < minimum || n > maximum) throw new SyntaxError(`Invalid score number at ${start + 1}`);
    return n;
  };
  const repeat = (start, count) => {
    if (!code.slice(start).some(event => event.op === 'note')) {
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
      i = end + 1; continue;
    }
    if (/\d/.test(c)) {
      i--;
      const n = number(1, 12);
      if (n >= 10) { previous = duration; triplet = 3; }
      duration = n; continue;
    }
    if (c === '_') { tie += beats[duration]; continue; }
    if (c === '#') { accidental++; continue; }
    if (c === '$') { accidental--; continue; }
    if (c === '(') { openings.push(code.length); continue; }
    if (c === ')') {
      if (openings.length) repeat(openings.pop(), 2);
      else if (++unmatchedClosing >= 2) {
        if (unmatched < 0) throw new SyntaxError('A loop needs a note or rest');
        code[unmatched].count = 0;
      } else unmatched = repeat(0, 2);
      continue;
    }
    if (c === 'O') { octave = number(0, 8); continue; }
    if ('VWXTM'.includes(c)) {
      const ranges = { V: [0, 15], W: [0, 7], X: [0, 65535], T: [60, 240], M: [1, 63] };
      code.push({ op: c, value: number(...ranges[c]) }); continue;
    }
    if (c === 'U' || c === 'H') { code.push({ op: c }); continue; }
    if (c === '&' || /[a-g]/i.test(c)) {
      const semitone = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[c.toLowerCase()];
      // Spectrum O5 puts lower-case c at middle C (MIDI 60).
      const midi = octave * 12 + semitone + (c !== c.toLowerCase() ? 12 : 0) + accidental;
      code.push({ op: 'note', frequency: c === '&' ? 0 : 440 * 2 ** ((midi - 69) / 12), beats: beats[duration] + tie });
      accidental = tie = 0;
      if (triplet && --triplet === 0) duration = previous;
      continue;
    }
    throw new SyntaxError(`Unknown score command ${c} at ${i}`);
  }
  while (openings.length) repeat(openings.pop(), 2);
  if (tie || accidental) throw new SyntaxError('Incomplete score note');
  if (code.length > 16384) throw new RangeError('Score has too many commands');
  return { code, fixedVolume: code.some(event => event.op === 'V') };
}

// Three square-wave channels, shared 17-bit noise, shared 16-step envelope.
// A digital AY model; it does not model the analog output circuitry.
export class AY {
  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.clock = 1773400;
    this.levels = [0, .00999, .01445, .021, .0307, .045, .0645, .107, .1266, .205, .2922, .3728, .4925, .6353, .8056, 1];
    this.reset();
  }
  reset() {
    this.voices = [null, null, null];
    this.phase = [0, 0, 0];
    this.period = [1, 1, 1];
    this.mixer = 7; this.tempo = 120;
    this.noise = 0x1ffff; this.noisePhase = 0; this.noisePeriod = 1;
    this.envelopePeriod = 65535; this.shape = 0;
    this.trigger();
    this.lastInput = this.lastOutput = 0;
  }
  trigger() { this.envelopePhase = 0; this.envelopeStep = 0; this.attack = !!(this.shape & 4); this.envelopeHeld = false; this.envelopeLevel = this.attack ? 0 : 15; }
  play(ch, program) {
    this.voices[ch] = program.code.length ? { program, pc: 0, loops: new Map(), remaining: 0, volume: 15, envelope: false, sounding: false } : null;
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
            voice.loops.set(position, count - 1); voice.pc = event.start;
          } else voice.loops.delete(position);
          break;
        }
        case 'T': if (ch === 0) this.tempo = event.value; break;
        case 'M': this.mixer = event.value; break;
        case 'V': voice.volume = event.value; voice.envelope = false; break;
        case 'W': this.shape = [0, 4, 9, 13, 8, 12, 14, 10][event.value]; break;
        case 'X': this.envelopePeriod = Math.max(1, event.value); break;
        case 'U': voice.envelope = !voice.program.fixedVolume; break;
        case 'H': this.voices.fill(null); return;
        case 'note':
          voice.remaining += event.beats;
          voice.sounding = event.frequency > 0;
          if (voice.sounding) {
            this.period[ch] = Math.max(1, Math.min(4095, Math.round(this.clock / (16 * event.frequency))));
            if (this.mixer & (8 << ch)) this.noisePeriod = Math.max(1, this.period[ch] & 31);
            if (voice.envelope) this.trigger();
          }
          return;
      }
    }
    this.voices[ch] = null;
  }
  sample() {
    for (let ch = 0; ch < 3; ch++) {
      const voice = this.voices[ch];
      if (voice && voice.remaining <= 0) this.next(ch, voice);
      if (this.voices[ch]) this.voices[ch].remaining -= this.tempo / (60 * this.sampleRate);
      this.phase[ch] = (this.phase[ch] + this.clock / (16 * this.period[ch] * this.sampleRate)) % 1;
    }
    this.noisePhase += this.clock / (16 * this.noisePeriod * this.sampleRate);
    while (this.noisePhase >= 1) {
      this.noisePhase--;
      this.noise = (this.noise >>> 1) | (((this.noise ^ (this.noise >>> 3)) & 1) << 16);
    }
    this.envelopePhase += this.clock / (16 * this.envelopePeriod * this.sampleRate);
    while (this.envelopePhase >= 1) {
      this.envelopePhase--;
      if (this.envelopeHeld) continue;
      this.envelopeStep++;
      if (this.envelopeStep === 16) {
        if (!(this.shape & 8)) { this.envelopeHeld = true; this.envelopeLevel = 0; continue; }
        if (this.shape & 1) {
          this.envelopeHeld = true;
          this.envelopeLevel = this.shape & 2 ? (this.attack ? 0 : 15) : (this.attack ? 15 : 0);
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
      const tone = !(this.mixer & (1 << ch)) || this.phase[ch] < .5;
      const noise = !(this.mixer & (8 << ch)) || (this.noise & 1);
      if (tone && noise) sum += this.levels[voice.envelope ? this.envelopeLevel : voice.volume];
    }
    const input = sum * .2;
    const output = input - this.lastInput + .995 * this.lastOutput;
    this.lastInput = input; this.lastOutput = output;
    return output;
  }
  render(length) { return Float32Array.from({ length }, () => this.sample()); }
}
