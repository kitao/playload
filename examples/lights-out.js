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
let board;

// Four 8×8 characters form each 16×16 lamp, with four pixels between lamps.
const lampPatterns = [
  '071f3f7f7fffffff',
  'e0f8fcfefeffffff',
  'ffffff7f7f3f1f07',
  'fffffffefefcf8e0',
  '0718204040808080',
  'e018040202010101',
  '8080804040201807',
  '01010102020418e0',
];
for (const [i, chr] of [...'①②③④⑤⑥⑦⑧'].entries()) pcg[chr].pat = lampPatterns[i];
pcg['┌'].pat = 'f880808080000000';
pcg['┐'].pat = '1f01010101000000';
pcg['└'].pat = '00000080808080f8';
pcg['┘'].pat = '000000010101011f';

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
      board[ny][nx] = !board[ny][nx];
    }
  }
}

function isClear() {
  return board.every((row) => row.every((light) => !light));
}

function drawStatus() {
  const last = level === puzzles.length - 1;
  const messages = [
    `LIGHTS OUT ${level + 1}/${puzzles.length}`,
    `MOVES ${moves}  PAR ${puzzles[level].length}`,
    cleared ? (last ? 'ALL BOARDS CLEAR!' : 'BOARD CLEAR!') : 'TURN ALL LIGHTS OFF',
    cleared ? (last ? 'A AGAIN  B RESTART' : 'A NEXT  B RETRY') : '↑↓←→ A FLIP B RETRY',
  ];
  for (const [i, row] of [0, 1, 16, 17].entries()) {
    put(0, row, ' '.repeat(20));
    put(Math.floor((20 - messages[i].length) / 2), row, messages[i], i === 0 ? 6 : 7);
  }
}

function startPuzzle() {
  x = 2;
  y = 2;
  moves = 0;
  cleared = false;
  board = Array.from({ length: 5 }, () => Array(5).fill(false));

  cls(0);
  for (const [cx, cy] of puzzles[level]) flip(cx, cy);
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
    x = Math.max(0, Math.min(4, x + btnp(3) - btnp(2)));
    y = Math.max(0, Math.min(4, y + btnp(1) - btnp(0)));
    if (btnp(4)) {
      flip(x, y);
      moves++;
      cleared = isClear();
      drawStatus();
      play(0, cleared ? 'T240V12O5N2cegC' : 'T240V10O5N1c');
    }
  }

  for (let cy = 0; cy < 5; cy++) {
    for (let cx = 0; cx < 5; cx++) {
      spr(32 + cx * 20, 24 + cy * 20, board[cy][cx] ? '①②\n③④' : '⑤⑥\n⑦⑧', board[cy][cx] ? 6 : 4);
    }
  }
  const px = 32 + x * 20;
  const py = 24 + y * 20;
  spr(px - 2, py - 2, '┌', 7);
  spr(px + 10, py - 2, '┐', 7);
  spr(px - 2, py + 10, '└', 7);
  spr(px + 10, py + 10, '┘', 7);
}
