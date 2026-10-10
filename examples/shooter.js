// @title Shooter
// Left/right moves; Z fires, X restarts. Characters stay in scr; sprites move by pixels.

let x = 76;
let frame = 0;
let score = 0;
let shots = [];

const targets = [28, 76, 124].map((x) => ({ x, y: 24, alive: true }));

// Custom 8×8 ship, one byte per row.
pcg['🚀'].pat = [0x18, 0x3c, 0x24, 0x3c, 0x7e, 0xdb, 0x18, 0x24];
pcg['↑'].pat = '183C7E1818181800';
pcg['·'].col = [1, 0];

function drawStatus() {
  put(1, 1, `HITS ${score}/3`, 6, 0);
  put(2, 16, (score === 3 ? 'CLEAR! B RESET' : 'A FIRE  B RESET').padEnd(16), 7, 0);
}

// Screen cells stay until changed, so draw the stars only once.
for (let i = 0; i < 30; i++) {
  scr[3 + (i % 12)][(i * 7) % 20].chr = '·';
}
drawStatus();

function tick() {
  if (btnp(5)) {
    x = 76;
    score = 0;
    frame = 0;
    shots = [];
    for (const target of targets) {
      target.alive = true;
    }
    drawStatus();
  }

  frame++;
  x += (btn(3) - btn(2)) * 2;
  x = Math.max(0, Math.min(152, x));

  if (btnp(4) && shots.length < 16) {
    shots.push({ x, y: 112 });
    play(1, 'V10O6N1G');
  }

  for (const [i, target] of targets.entries()) {
    target.y = 24 + Math.round(Math.sin(frame / 30 + i) * 4);
  }

  for (const shot of shots) {
    shot.y -= 4;
    const hit = targets.find(
      (target) =>
        target.alive && Math.abs(target.x - shot.x) < 8 && Math.abs(target.y - shot.y) < 8,
    );
    if (hit) {
      hit.alive = false;
      score++;
      shot.y = -8;
      drawStatus();
      play(2, 'V12O4N1gc');
    }
  }
  shots = shots.filter((shot) => shot.y > -8);

  for (const target of targets) {
    if (target.alive) {
      spr(target.x, target.y, '👾', 3);
    }
  }
  spr(x, 120, '🚀', 4);
  for (const shot of shots) {
    spr(shot.x, shot.y, '↑', 6);
  }
}
