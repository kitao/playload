// @title Music Box
// Left/Right selects a step; Up/Down changes its note. A plays; B resets.

const pitches = ['c', 'd', 'e', 'f', 'g', 'a', 'b', 'C'];
const initialNotes = [0, 2, 4, 7, 5, 4, 2, 0];
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
  const current = Math.floor(frame / 30) % 8;
  for (let note = 0; note < 8; note++) {
    for (let step = 0; step < 8; step++) {
      const col1 = playing && step === current ? 6 : 4;
      const col2 = step === selected ? 1 : 0;
      const chr = notes[step] === note ? '♪' : '·';
      put(5 + step, 12 - note, chr, col1, col2);
    }
  }
  put(2, 16, playing ? 'A STOP  B RESET' : 'A PLAY  B RESET');
}

put(5, 1, 'MUSIC BOX', 6);
put(6, 3, '8 NOTES');
for (let note = 0; note < 8; note++) {
  put(3, 12 - note, pitches[note], 2);
}
put(5, 13, '12345678', 2);
put(2, 15, 'STEP ←→ NOTE ↑↓');
drawNotes();

function tick() {
  const previousSelected = selected;
  if (btnp(2)) {
    selected = Math.max(0, selected - 1);
  }
  if (btnp(3)) {
    selected = Math.min(7, selected + 1);
  }
  if (selected !== previousSelected) {
    drawNotes();
  }

  const previous = notes[selected];
  if (btnp(0)) {
    notes[selected] = Math.min(7, notes[selected] + 1);
  }
  if (btnp(1)) {
    notes[selected] = Math.max(0, notes[selected] - 1);
  }
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
