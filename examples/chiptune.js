// @title Chiptune
// Three-channel AY-style music: melody, bass and shared-envelope noise drums.

let music = true;
let frame = 0;

const melody =
  'T150M35V12O5N3e&g&Cege d&g&Bdgd c&f&Acfc d&g&BAGg ' + 'e&g&Cege d&g&Bdgd c&f&Acfc N5gN3deN5c&))';
const bass = 'V11O3N3c&g&c&g& d&g&d&g& f&c&f&c& g&d&g&d&))';
const drums = 'UX600W0O3N1c&c&c&c&c&c&c&c&))';

pcg['·'].pat = '0000001818000000';
pcg['■'].pat = 'ffffffffffffffff';

function startMusic() {
  play(0, melody);
  play(1, bass);
  play(2, drums);
}

startMusic();

function tick() {
  if (btnp(4)) {
    music = !music;
    if (music) {
      startMusic();
    } else {
      for (let ch = 0; ch < 3; ch++) {
        play(ch, '');
      }
    }
  }

  if (btnp(5)) {
    frame = 0;
    music = true;
    startMusic();
  }

  if (music) {
    frame++;
  }

  cls(0);
  put(6, 2, 'CHIPTUNE', 6);
  put(6, 4, '3 VOICES');

  for (let i = 0; i < 24; i++) {
    put((i * 7) % 19, 6 + ((i * 3) % 7), '·', 2);
  }

  put(6, 7, '👾 💎 👾', 4);
  for (let ch = 0; ch < 3; ch++) {
    const ticksPerStep = ch === 2 ? 6 : 12;
    const position = Math.floor(frame / ticksPerStep) % 12;
    for (let i = 0; i < 12; i++) {
      const col = music && i === position ? 4 + ch : 1;
      put(4 + i, 10 + ch, '■', col);
    }
  }

  put(2, 15, music ? 'A STOP  B RESET' : 'A PLAY  B RESET');
}
