// @title Jump
// Left/right moves; Z / A jumps, X / B restarts. Reach the red flag.

let x;
let y;
let dy;
let grounded;
let won;
let lost;

// Platforms use cells; the player's position and velocity use pixels.
const platforms = [
  { x: 1, y: 14, width: 5 },
  { x: 7, y: 11, width: 4 },
  { x: 13, y: 8, width: 5 },
  { x: 7, y: 6, width: 4 },
  { x: 14, y: 5, width: 5 },
];

// Each pair of hex digits draws one row of the 8×8 flag.
pcg['🚩'].pat = '7c7c7c4040404000';

function drawResult() {
  put(2, 1, (won ? 'FLAG REACHED!' : 'YOU FELL!').padEnd(16), won ? 6 : 3);
  put(2, 16, (won ? '  B PLAY AGAIN' : '  B TRY AGAIN').padEnd(16));
  put(6, 17, ' '.repeat(7));
}

function reset() {
  x = 16;
  y = 104;
  dy = 0;
  grounded = true;
  won = false;
  lost = false;

  cls(0);
  put(2, 1, 'JUMP TO THE FLAG');
  put(2, 4, '·', 1);
  put(10, 3, '★', 1);
  put(4, 8, '·', 1);
  put(18, 10, '★', 1);
  for (const platform of platforms) {
    put(platform.x, platform.y, '▀'.repeat(platform.width), 5, 1);
  }
  put(17, 4, '🚩', 3);
  put(0, 15, '~'.repeat(20), 3);
  put(2, 16, '← → MOVE  A JUMP');
  put(6, 17, 'B RESET');
  play(0, '');
}

reset();

function tick() {
  if (btnp(5)) {
    reset();
  }

  if (!won && !lost) {
    x += (btn(3) - btn(2)) * 2;
    x = Math.max(0, Math.min(152, x));

    if (btnp(4) && grounded) {
      dy = -4.5;
      play(0, 'T240V10O5N1cG');
    }

    const previousBottom = y + 8;
    dy = Math.min(dy + 0.3, 3);
    y += dy;
    grounded = false;

    if (y < 16) {
      y = 16;
      dy = 0;
    }

    // Land only when the feet cross a platform's top while falling.
    for (const platform of platforms) {
      const left = platform.x * 8;
      const right = left + platform.width * 8;
      const top = platform.y * 8;
      if (dy >= 0 && previousBottom <= top && y + 8 >= top && x + 8 > left && x < right) {
        y = top - 8;
        dy = 0;
        grounded = true;
        break;
      }
    }

    if (Math.abs(x - 136) < 8 && Math.abs(y - 32) < 8) {
      won = true;
      drawResult();
      play(0, 'T180V12O5N2cegCN3G');
    }
    if (y >= 120) {
      lost = true;
      drawResult();
      play(0, 'T180V10O4N2gec');
    }
  }

  if (!lost) {
    spr(x, y, '👾', 6);
  }
}
