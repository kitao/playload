// @title Chiptune
// Three voices play a complete song. A stops / restarts; B resets the song.

let playing = true;
let frame = 0;

// Each row is a 4/4 bar; each section lasts four bars.
const sections = [
  {
    name: 'VERSE',
    melody: `
      3e&g&Cege
      3d&g&Bdgd
      3c&f&Acfc
      3d&g&BAGg
    `,
    bass: `
      c&g&c&g&
      d&g&d&g&
      f&c&f&c&
      g&d&g&d&
    `,
    drums: 'c&&&g&&&c&c&g&&&'.repeat(3) + 'c&&&g&&&c&g&cgg&',
  },
  {
    name: 'CHORUS',
    melody: `
      3Cege5C3ge
      3Aeae5A3ge
      3Afaf5A3gf
      3Gfed5c&
    `,
    bass: `
      c&g&c&g&
      a&e&a&e&
      f&c&f&c&
      g&d&g&d&
    `,
    drums: 'c&g&g&&&c&g&g&g&'.repeat(3) + 'c&g&g&&&c&g&cgg&',
  },
  {
    name: 'BRIDGE',
    melody: `
      V10O4N5f&ga
      5g&bd
      5e&gb
      5a&3ge5&
    `,
    bass: `
      V8N3f&c&f&c&
      g&d&g&d&
      e&b&e&b&
      a&e&a&e&
    `,
    drums: 'c&&&g&&&c&&&g&&&'.repeat(4),
  },
  {
    name: 'FINALE',
    melody: `
      V12O5N3Cege5C3ge
      3Aeae5A3ge
      3fagA5G3bd
      8c5&
    `,
    bass: `
      V10N3c&g&c&g&
      a&e&a&e&
      f&c&g&d&
      8c5&
    `,
    drums: 'c&g&g&&&c&g&g&g&'.repeat(3) + 'c&&&&&&&&&&&&&&&',
  },
];
const songTicks = sections.length * 384;

pcg['·'].pat = '0000001818000000';
pcg['■'].pat = [0, 0, 0x7e, 0x7e, 0x7e, 0x7e, 0, 0];

function startMusic() {
  // Only channel 0 sets tempo. M35 mixes its tone, bass tone and channel 2 noise.
  play(0, 'T150M35V12O5' + sections.map((section) => section.melody).join(' '));
  play(1, 'V10O3N3' + sections.map((section) => section.bass).join(' '));
  play(2, 'UX300W0O3N1' + sections.map((section) => section.drums).join(' '));
  frame = 0;
}

function drawVoices() {
  // At 150 BPM, one bar lasts 96 ticks and a sixteenth note lasts six.
  const section = Math.min(sections.length - 1, Math.floor(frame / 384));
  const bar = (Math.floor(frame / 96) % 4) + 1;
  const title = frame === songTicks ? 'FINISHED' : `${sections[section].name} ${bar}/4`;
  put(1, 4, ' '.repeat(18));
  put(Math.floor((20 - title.length) / 2), 4, title);

  for (let ch = 0; ch < 3; ch++) {
    const ticksPerStep = ch === 2 ? 6 : 12;
    const position = (Math.floor(frame / ticksPerStep) * (ticksPerStep / 6)) % 16;
    for (let i = 0; i < 16; i++) {
      const col = playing && i === position ? 4 + ch : 1;
      put(2 + i, 10 + ch * 2, '■', col);
    }
  }
  put(2, 16, playing ? 'A STOP  B RESET' : 'A PLAY  B RESET');
}

put(6, 2, 'CHIPTUNE', 6);
for (let i = 0; i < 24; i++) {
  put((i * 7) % 19, 6 + ((i * 3) % 7), '·', 2);
}
put(8, 7, '👾 💎 👾', 4);
for (let ch = 0; ch < 3; ch++) {
  put(2, 9 + ch * 2, ['MELODY', 'BASS', 'DRUMS'][ch], 4 + ch);
}
drawVoices();
startMusic();

function tick() {
  if (btnp(4)) {
    playing = !playing;
    if (playing) {
      startMusic();
    } else {
      for (let ch = 0; ch < 3; ch++) {
        play(ch, '');
      }
    }
    drawVoices();
  }

  if (btnp(5)) {
    playing = true;
    startMusic();
    drawVoices();
  }

  if (playing) {
    frame++;
    if (frame === songTicks) {
      playing = false;
    }
    if (frame % 6 === 0) {
      drawVoices();
    }
  }
}
