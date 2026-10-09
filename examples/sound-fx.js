// @title Sound FX
// Up / down selects an effect. Z / A plays it; X / B stops it.

let selected = 0;
let message = 'READY';

// Every tone effect restores M7; M8 gives channel 0 noise instead of tone.
const effects = [
  { name: 'COIN', sound: 'T180M7V12O6N1cG' },
  { name: 'JUMP', sound: 'T180M7V10O4N1cdefg' },
  { name: 'LASER', sound: 'T180M7V12O7N1Cbagfedc' },
  { name: 'HIT', sound: 'T180M8UX1800W0O3N1c' },
  { name: 'POWER UP', sound: 'T180M7V12O5N1cegC' },
  { name: 'VICTORY', sound: 'T150M7V12O5N3cegCN5G' },
];

function tick() {
  selected += btnp(1) - btnp(0);
  selected = Math.max(0, Math.min(effects.length - 1, selected));

  if (btnp(4)) {
    play(0, effects[selected].sound);
    message = `PLAY ${effects[selected].name}`;
  }
  if (btnp(5)) {
    play(0, '');
    message = 'STOPPED';
  }

  cls(0);
  put(4, 1, 'SOUND FX', 6);
  put(4, 2, message);
  for (let i = 0; i < effects.length; i++) {
    put(4, 4 + i * 2, effects[i].name, i === selected ? 6 : 7);
  }
  put(5, 15, '↑↓ SELECT');
  put(3, 16, 'A PLAY  B STOP');
  spr(16, 32 + selected * 16, '→', 6);
}
