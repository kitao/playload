// @title Music Box
// Left/right selects a step; up/down changes its note. A plays or stops; B resets.

const pitches = ['&', 'c', 'd', 'e', 'f', 'g', 'a', 'b', 'C'];
const initialNotes = [1, 3, 5, 8, 6, 5, 1, 0];
let notes = initialNotes.slice();
let selected = 0;
let playing = false;
let frame = 0;

function startMusic() {
  const melody = notes.map((note) => pitches[note]).join('');
  play(1, '');
  play(0, 'T120M7V12O5N5' + melody + '))');
  playing = true;
  frame = 0;
}

function stopMusic() {
  play(0, '');
  play(1, '');
  playing = false;
}

function drawNotes() {
  // At 120 BPM, a quarter note lasts 30 ticks.
  const current = Math.floor(frame / 30) % notes.length;
  for (let note = 0; note < pitches.length; note++) {
    for (let step = 0; step < notes.length; step++) {
      const col1 = playing && step === current ? 6 : 4;
      const col2 = step === selected ? 1 : 0;
      const chr = notes[step] === note ? (note === 0 ? '–' : '♪') : '·';
      put(3 + step * 2, 12 - note, chr, col1, col2);
    }
  }
  put(2, 16, playing ? 'A STOP  B RESET' : 'A PLAY  B RESET');
}

put(5, 1, 'MUSIC BOX', 6);
put(3, 3, '8 STEPS');
put(12, 3, '– REST', 2);
for (let note = 0; note < pitches.length; note++) {
  put(1, 12 - note, note === 0 ? '–' : pitches[note], 2);
}
for (let step = 0; step < notes.length; step++) {
  put(3 + step * 2, 13, String(step + 1), 2);
}
put(2, 15, 'STEP ←→ NOTE ↑↓');
drawNotes();

function tick() {
  const previousSelected = selected;
  selected = Math.max(0, Math.min(notes.length - 1, selected + btnp(3) - btnp(2)));
  if (selected !== previousSelected) {
    drawNotes();
  }

  const previous = notes[selected];
  notes[selected] = Math.max(0, Math.min(pitches.length - 1, notes[selected] + btnp(0) - btnp(1)));
  if (notes[selected] !== previous) {
    if (playing) {
      startMusic();
    } else {
      play(1, 'M7V10O5N1' + pitches[notes[selected]]);
    }
    drawNotes();
  }

  if (btnp(4)) {
    if (playing) {
      stopMusic();
    } else {
      startMusic();
    }
    drawNotes();
  }
  if (btnp(5)) {
    stopMusic();
    notes = initialNotes.slice();
    selected = 0;
    frame = 0;
    drawNotes();
  }

  if (playing) {
    frame++;
    if (frame % 30 === 0) {
      drawNotes();
    }
  }
}
