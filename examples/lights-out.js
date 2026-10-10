// @title Lights Out
// Arrows select a light; Z flips it and its neighbors. X restarts.

let x = 2;
let y = 2;
let moves = 0;

// Each pair of hex digits draws one row. Colors are foreground, background.
pcg['●'].pat = '3c7effffffff7e3c';
pcg['●'].col = [6, 0];
pcg['○'].pat = '3c4281818181423c';
pcg['○'].col = [4, 0];

function flip(cx, cy) {
  const neighbors = [
    [0, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  for (const [dx, dy] of neighbors) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx >= 0 && nx < 5 && ny >= 0 && ny < 5) {
      // scr[row][column] is both the display and the board's state.
      const cell = scr[4 + ny * 2][6 + nx * 2];
      cell.chr = cell.chr === '●' ? '○' : '●';
    }
  }
}

function reset() {
  x = 2;
  y = 2;
  moves = 0;

  cls(0);
  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      put(6 + cx * 2, 4 + cy * 2, '○');
    }
  }
  // Starting from an empty board makes the puzzle solvable by reversing these flips.
  flip(0, 0);
  flip(1, 3);
  flip(4, 2);
  flip(2, 2);
  scr[4 + y * 2][6 + x * 2].col[1] = 1;
  put(1, 2, 'TURN ALL LIGHTS OFF');
  put(3, 15, 'ARROWS SELECT');
  put(2, 16, 'A FLIP  B RESET');
  drawStatus();
  play(0, '');
}

function drawStatus() {
  let lights = 0;
  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      if (scr[4 + cy * 2][6 + cx * 2].chr === '●') {
        lights += 1;
      }
    }
  }

  put(5, 1, lights === 0 ? 'ALL CLEAR!' : 'LIGHTS OUT ', 6);
  put(5, 14, `MOVES ${moves}`.padEnd(12));
}

reset();

function tick() {
  // btnp moves once per press, unlike the held movement in Gems.
  const previousX = x;
  const previousY = y;
  x += btnp(3) - btnp(2);
  y += btnp(1) - btnp(0);
  x = Math.max(0, Math.min(4, x));
  y = Math.max(0, Math.min(4, y));

  if (x !== previousX || y !== previousY) {
    // Highlight only this cell's background; null restores its PCG color.
    scr[4 + previousY * 2][6 + previousX * 2].col[1] = null;
    scr[4 + y * 2][6 + x * 2].col[1] = 1;
  }

  if (btnp(5)) {
    reset();
  }
  if (btnp(4)) {
    flip(x, y);
    moves += 1;
    drawStatus();
    play(0, 'V10O5N1c');
  }

  spr(40 + x * 16, 32 + y * 16, '→', 7);
}
