// @title Gems
// Arrows move, Z boosts speed, X moves the gem.

// State persists between ticks; sprite positions use pixels.
let x = 76;
let y = 68;
let score = 0;

let gx = 36;
let gy = 44;

function placeGem() {
  gx = 8 + Math.floor(Math.random() * 17) * 8;
  gy = 24 + Math.floor(Math.random() * 12) * 8;
}

play(0, 'T150O4N3cegb))');

function tick() {
  const speed = btn(4) ? 2 : 1;
  x += (btn(3) - btn(2)) * speed;
  y += (btn(1) - btn(0)) * speed;

  x = Math.max(8, Math.min(144, x));
  y = Math.max(24, Math.min(112, y));

  if (Math.abs(x - gx) < 6 && Math.abs(y - gy) < 6) {
    score++;
    placeGem();
    play(1, 'O6N1GC');
  }

  if (btnp(5)) {
    placeGem();
    play(2, 'O3N1c');
  }

  cls(1);
  put(1, 1, `GEMS ${score}`, 7, 1);
  put(4, 15, 'ARROWS MOVE', 7, 1);
  put(3, 16, 'A FAST  B GEM', 7, 1);
  spr(gx, gy, '💎', 4);
  spr(x, y, '👾', 6);
}
