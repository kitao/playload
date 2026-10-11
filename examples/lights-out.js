// @title Lights Out
// Arrows select; A flips a light and its neighbors. B retries the board.

// Reverse these flips to solve each board; PAR is its minimum move count.
const puzzles = [
  [
    [1, 1],
    [3, 3],
  ],
  [
    [0, 0],
    [2, 2],
    [4, 4],
  ],
  [
    [0, 4],
    [1, 1],
    [3, 3],
    [4, 0],
  ],
  [
    [0, 2],
    [2, 0],
    [2, 2],
    [2, 4],
    [4, 2],
  ],
  [
    [0, 0],
    [1, 3],
    [2, 1],
    [2, 4],
    [3, 2],
    [4, 4],
  ],
];

let level = 0;
let x;
let y;
let moves;
let cleared;

pcg['●'].pat = '3c7effffffff7e3c';
pcg['●'].col = [6, 0];
pcg['○'].pat = '3c4281818181423c';
pcg['○'].col = [4, 0];

function flip(cx, cy) {
  for (const [dx, dy] of [
    [0, 0],
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx >= 0 && nx < 5 && ny >= 0 && ny < 5) {
      // The screen cells are also the board's state.
      const cell = scr[4 + ny * 2][6 + nx * 2];
      cell.chr = cell.chr === '●' ? '○' : '●';
    }
  }
}

function isClear() {
  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      if (scr[4 + cy * 2][6 + cx * 2].chr === '●') return false;
    }
  }
  return true;
}

function drawStatus() {
  const last = level === puzzles.length - 1;
  let title = 'TURN LIGHTS OFF';
  let action = 'ARROWS SELECT';
  if (cleared) {
    title = last ? 'ALL BOARDS CLEAR!' : 'BOARD CLEAR!';
    action = last ? 'A PLAY AGAIN' : 'A NEXT BOARD';
  }
  put(3, 1, `LIGHTS OUT ${level + 1}/${puzzles.length}`, 6);
  put(1, 2, ' '.repeat(18));
  put(Math.floor((20 - title.length) / 2), 2, title);
  const score = `MOVES ${moves}  PAR ${puzzles[level].length}`;
  put(1, 14, ' '.repeat(18));
  put(Math.floor((20 - score.length) / 2), 14, score);
  put(1, 15, ' '.repeat(18));
  put(Math.floor((20 - action.length) / 2), 15, action);
  const retry = cleared ? (last ? 'B RESTART' : 'B RETRY') : 'A FLIP  B RETRY';
  put(1, 16, ' '.repeat(18));
  put(Math.floor((20 - retry.length) / 2), 16, retry);
}

function startPuzzle() {
  x = 2;
  y = 2;
  moves = 0;
  cleared = false;

  cls(0);
  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      put(6 + cx * 2, 4 + cy * 2, '○');
    }
  }
  for (const [cx, cy] of puzzles[level]) flip(cx, cy);
  scr[4 + y * 2][6 + x * 2].col[1] = 1;
  drawStatus();
  play(0, '');
}

startPuzzle();

function tick() {
  if (btnp(5)) {
    if (cleared && level === puzzles.length - 1) level = 0;
    startPuzzle();
  } else if (cleared) {
    if (btnp(4)) {
      level = (level + 1) % puzzles.length;
      startPuzzle();
    }
  } else {
    const previousX = x;
    const previousY = y;
    x = Math.max(0, Math.min(4, x + btnp(3) - btnp(2)));
    y = Math.max(0, Math.min(4, y + btnp(1) - btnp(0)));

    if (x !== previousX || y !== previousY) {
      scr[4 + previousY * 2][6 + previousX * 2].col[1] = null;
      scr[4 + y * 2][6 + x * 2].col[1] = 1;
    }
    if (btnp(4)) {
      flip(x, y);
      moves++;
      cleared = isClear();
      drawStatus();
      play(0, cleared ? 'T240O5N2cegC' : 'T240V10O5N1c');
    }
  }

  spr(40 + x * 16, 32 + y * 16, '→', 7);
}
