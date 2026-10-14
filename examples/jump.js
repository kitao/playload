// @title Jump
// Move left/right, A jumps, B retries. Reach all four flags.

const stages = [
  {
    name: 'FIRST STEPS',
    platforms: [
      [1, 14, 5],
      [8, 11, 4],
      [14, 8, 5],
    ],
    flag: [17, 7],
  },
  {
    name: 'SWITCHBACK',
    platforms: [
      [4, 14, 5],
      [11, 11, 3],
      [5, 8, 3],
      [12, 5, 3],
    ],
    flag: [13, 4],
  },
  {
    name: 'FERRY',
    platforms: [
      [1, 14, 5],
      [15, 8, 4],
    ],
    flag: [17, 7],
    ferry: { x: 48, y: 88, width: 24, min: 48, max: 104, dx: 0.75 },
  },
  {
    name: 'PATROL',
    platforms: [
      [3, 14, 4],
      [8, 11, 5],
      [14, 8, 3],
      [7, 5, 3],
    ],
    flag: [8, 4],
    hazard: { x: 84, y: 80, min: 64, max: 96, dx: 0.6 },
  },
];

let stage = 0;
let state;
let x, y, dy;
let grounded, standing;
let jumpBuffer, coyote;
let platforms, ferry, hazard;

pcg['🚩'].pat = '7c7c7c4040404000';

function finish(result) {
  state = result;
  const last = stage === stages.length - 1;
  const message = result === 'OVER' ? 'TRY AGAIN!' : last ? 'ALL CLEAR!' : 'STAGE CLEAR!';
  const hint = result === 'OVER' ? 'A / B RETRY' : last ? 'A / B PLAY AGAIN' : 'A NEXT  B RETRY';
  put(0, 1, ' '.repeat(20));
  put(Math.floor((20 - message.length) / 2), 1, message, 6);
  put(0, 16, ' '.repeat(20));
  put(Math.floor((20 - hint.length) / 2), 16, hint);
  play(0, result === 'OVER' ? 'T240V10O4N1gec' : 'T240V12O5N1cegC');
}

function reset() {
  const level = stages[stage];
  x = (level.platforms[0][0] + 1) * 8;
  y = 104;
  dy = 0;
  grounded = true;
  standing = null;
  jumpBuffer = 0;
  coyote = 0;
  state = 'PLAY';

  // Level data uses cells; movement and collision use pixels.
  platforms = level.platforms.map(([cx, cy, width]) => ({
    x: cx * 8,
    y: cy * 8,
    width: width * 8,
  }));
  ferry = level.ferry ? { ...level.ferry } : null;
  hazard = level.hazard ? { ...level.hazard } : null;

  cls(0);
  const title = `${stage + 1}/${stages.length} ${level.name}`;
  put(Math.floor((20 - title.length) / 2), 1, title, 6);
  put(2, 4, '·', 1);
  put(17, 3, '★', 1);
  for (const platform of platforms) {
    put(platform.x / 8, platform.y / 8, '▀'.repeat(platform.width / 8), 5, 1);
  }
  if (ferry) platforms.push(ferry);
  put(level.flag[0], level.flag[1], '🚩', 3);
  put(0, 15, '~'.repeat(20), 3);
  put(1, 16, '←→ A JUMP B RETRY');
  play(0, '');
}

function advance(object) {
  if (!object) return 0;
  const previous = object.x;
  object.x += object.dx;
  if (object.x < object.min || object.x > object.max) {
    object.x = Math.max(object.min, Math.min(object.max, object.x));
    object.dx = -object.dx;
  }
  return object.x - previous;
}

function update() {
  const shift = advance(ferry);
  advance(hazard);
  if (ferry && standing === ferry) x += shift;
  x += (btn(3) - btn(2)) * 2;
  x = Math.max(0, Math.min(152, x));

  // Brief input buffering and coyote time make edge jumps forgiving.
  jumpBuffer = btnp(4) ? 6 : Math.max(0, jumpBuffer - 1);
  coyote = grounded ? 5 : Math.max(0, coyote - 1);
  if (jumpBuffer && coyote) {
    dy = -4.8;
    jumpBuffer = 0;
    coyote = 0;
    play(0, 'T240V10O5N1c');
  }

  const previousBottom = y + 8;
  dy = Math.min(dy + 0.28, 4);
  y += dy;
  grounded = false;
  standing = null;
  if (y < 16) {
    y = 16;
    dy = 0;
  }

  // These are one-way platforms: land when falling feet cross their top.
  for (const platform of platforms) {
    if (
      dy >= 0 &&
      previousBottom <= platform.y &&
      y + 8 >= platform.y &&
      x + 8 > platform.x &&
      x < platform.x + platform.width
    ) {
      y = platform.y - 8;
      dy = 0;
      grounded = true;
      standing = platform;
      break;
    }
  }

  if (y >= 120 || (hazard && Math.abs(x - hazard.x) < 6 && Math.abs(y - hazard.y) < 6)) {
    finish('OVER');
  } else {
    const [fx, fy] = stages[stage].flag;
    if (Math.abs(x - fx * 8) < 7 && Math.abs(y - fy * 8) < 7) {
      finish(stage === stages.length - 1 ? 'DONE' : 'CLEAR');
    }
  }
}

reset();

function tick() {
  if (btnp(5) || (state !== 'PLAY' && btnp(4))) {
    if (state === 'DONE') stage = 0;
    else if (state === 'CLEAR' && btnp(4) && !btnp(5)) stage++;
    reset();
  } else if (state === 'PLAY') {
    update();
  }

  if (ferry) spr(ferry.x, ferry.y, '▀'.repeat(ferry.width / 8), 4);
  if (hazard) spr(hazard.x, hazard.y, '💀', 3);
  if (state !== 'OVER') spr(x, y, '👾', 6);
}
