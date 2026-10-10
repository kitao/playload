// @title Sound FX
// Up / down selects an effect. Z plays it; X stops it.

let selected = 0;

// Every tone effect restores M7; M8 gives channel 0 noise instead of tone.
const effects = [
  { name: 'COIN', sound: 'T180M7V12O6N1cG' },
  { name: 'JUMP', sound: 'T180M7V10O4N1cdefg' },
  { name: 'LASER', sound: 'T180M7V12O7N1Cbagfedc' },
  { name: 'HIT', sound: 'T180M8UX1800W0O3N1c' },
  { name: 'POWER UP', sound: 'T180M7V12O5N1cegC' },
  { name: 'VICTORY', sound: 'T150M7V12O5N3cegCN5G' },
];

put(4, 1, 'SOUND FX', 6);
put(4, 2, 'READY');
for (let i = 0; i < effects.length; i++) {
  put(4, 4 + i * 2, effects[i].name, i === selected ? 6 : 7);
}
put(5, 15, '↑↓ SELECT');
put(3, 16, 'A PLAY  B STOP');

function tick() {
  const previous = selected;
  selected += btnp(1) - btnp(0);
  selected = Math.max(0, Math.min(effects.length - 1, selected));

  if (selected !== previous) {
    put(4, 4 + previous * 2, effects[previous].name, 7);
    put(4, 4 + selected * 2, effects[selected].name, 6);
  }

  if (btnp(4)) {
    play(0, effects[selected].sound);
    put(4, 2, `PLAY ${effects[selected].name}`.padEnd(16));
  }
  if (btnp(5)) {
    play(0, '');
    put(4, 2, 'STOPPED'.padEnd(16));
  }

  spr(16, 32 + selected * 16, '→', 6);
}
