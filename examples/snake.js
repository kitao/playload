// @title Snake
// ⬆⬇⬅➡ turn; Ⓐ starts or pauses. Ⓑ restarts.

const width = 18;
const height = 14;
const directions = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
const opposite = [1, 0, 3, 2];

let body = [];
let food;
let direction = 3;
let nextDirection = 3;
let frame = 0;
let score = 0;
let state = 'READY';

function chooseFood() {
  const empty = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!body.some((cell) => cell.x === x && cell.y === y)) {
        empty.push({ x, y });
      }
    }
  }
  // Choosing from empty cells also handles a completely filled board.
  if (empty.length === 0) {
    return null;
  }
  return empty[Math.floor(Math.random() * empty.length)];
}

function drawGems() {
  put(11, 0, `GEMS ${score}`);
  if (food) {
    put(1 + food.x, 2 + food.y, '💎', 4);
  }
}

function drawBoard() {
  for (let y = 0; y < height; y++) {
    put(1, 2 + y, ' '.repeat(width));
  }
  drawGems();
  for (let i = 0; i < body.length; i++) {
    put(1 + body[i].x, 2 + body[i].y, '●', i === 0 ? 6 : 5);
  }

  if (state === 'PAUSED') {
    put(7, 8, 'PAUSED', 7, 0);
  } else if (state === 'OVER') {
    put(5, 8, 'GAME OVER', 3, 0);
  } else if (state === 'WON') {
    put(5, 8, 'ALL CLEAR!', 6, 0);
  }
  const action = { READY: 'START', PLAY: 'PAUSE', PAUSED: 'RESUME', OVER: 'RETRY', WON: 'AGAIN' }[
    state
  ];
  put(2, 17, `Ⓐ ${action.padEnd(6)} Ⓑ RESET`);
}

function reset() {
  // The first array element is the head; the last is the tail.
  body = [
    { x: 8, y: 6 },
    { x: 7, y: 6 },
    { x: 6, y: 6 },
  ];
  direction = 3;
  nextDirection = 3;
  frame = 0;
  score = 0;
  state = 'READY';
  food = chooseFood();

  cls(0);
  put(1, 0, 'SNAKE', 6);
  put(0, 1, '▓'.repeat(20), 1);
  put(0, height + 2, '▓'.repeat(20), 1);
  for (let y = 0; y < height; y++) {
    put(0, 2 + y, '▓', 1);
    put(19, 2 + y, '▓', 1);
  }
  drawBoard();
  play(0, '');
}

function move() {
  const [dx, dy] = directions[nextDirection];
  const x = body[0].x + dx;
  const y = body[0].y + dy;
  const grows = x === food.x && y === food.y;

  // The tail leaves its cell on a move that does not eat food.
  const occupied = grows ? body : body.slice(0, -1);
  if (
    x < 0 ||
    x >= width ||
    y < 0 ||
    y >= height ||
    occupied.some((cell) => cell.x === x && cell.y === y)
  ) {
    state = 'OVER';
    drawBoard();
    play(0, 'T180V10O3N1gc');
    return;
  }

  direction = nextDirection;
  body.unshift({ x, y });
  if (!grows) {
    const tail = body.pop();
    put(1 + tail.x, 2 + tail.y, ' ');
  }
  put(1 + body[1].x, 2 + body[1].y, '●', 5);
  put(1 + x, 2 + y, '●', 6);

  if (grows) {
    score += 1;
    play(0, 'T240V10O6N1cG');
    food = chooseFood();
    if (food) {
      drawGems();
    } else {
      state = 'WON';
      drawBoard();
      play(0, 'T180V10O5N3cegC');
    }
  }
}

reset();

function tick() {
  if (btnp(5)) {
    reset();
  }
  if (btnp(4)) {
    if (state === 'PLAY') {
      state = 'PAUSED';
    } else {
      if (state === 'OVER' || state === 'WON') {
        reset();
      }
      state = 'PLAY';
    }
    drawBoard();
  }

  if (state === 'PLAY') {
    for (let id = 0; id < 4; id++) {
      // Compare with the last move, so quick turns cannot reverse into the neck.
      if (btnp(id) && id !== opposite[direction]) {
        nextDirection = id;
      }
    }
    frame += 1;
    if (frame % 8 === 0) {
      move();
    }
  }
}
