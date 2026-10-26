// @title Sound FX
// ⬆⬇ select an effect. Ⓐ plays it; Ⓑ stops it.

let selected = 0;
let pulse = 0;

// Every tone effect restores M7; M8 gives channel 0 noise instead of tone.
const effects = [
  { name: 'COIN', sound: 'T180M7V12O6N1cG' },
  { name: 'JUMP', sound: 'T180M7V10O4N1cdefg' },
  { name: 'LASER', sound: 'T180M7V12O7N1Cbagfedc' },
  { name: 'HIT', sound: 'T180M8UX1800W0O3N1c' },
  { name: 'POWER UP', sound: 'T180M7V12O5N1cegC' },
  { name: 'VICTORY', sound: 'T150M7V12O5N3cegCN5G' },
];

function putCentered(cy, str, col = 7) {
  put(1, cy, ' '.repeat(18));
  put(Math.floor((20 - str.length) / 2), cy, str, col);
}

function drawEffect() {
  const [settings, notes] = effects[selected].sound.split(/(?=O)/);
  putCentered(13, settings);
  putCentered(14, notes, 6);
}

put(6, 1, 'SOUND FX', 6);
putCentered(2, 'READY');
for (let i = 0; i < effects.length; i++) {
  put(7, 4 + i, effects[i].name, i === selected ? 6 : 7);
}
putCentered(12, 'ZX 128 PLAY', 2);
put(5, 15, '⬆⬇ SELECT');
put(3, 16, 'Ⓐ PLAY  Ⓑ STOP');
drawEffect();

function tick() {
  const previous = selected;
  selected += btnp(1) - btnp(0);
  selected = Math.max(0, Math.min(effects.length - 1, selected));

  if (selected !== previous) {
    pulse = 0;
    put(7, 4 + previous, effects[previous].name, 7);
    put(7, 4 + selected, effects[selected].name, 6);
    drawEffect();
  }

  if (btnp(4)) {
    play(0, effects[selected].sound);
    putCentered(2, `PLAY ${effects[selected].name}`);
    pulse = 18;
  }
  if (btnp(5)) {
    play(0, '');
    putCentered(2, 'STOPPED');
    pulse = 0;
  }

  spr(40, 32 + selected * 8, '→', pulse ? 7 : 6);
  if (pulse > 0) {
    spr(128, 32 + selected * 8 - pulse / 3, '♪', 6);
    pulse--;
  }
}
