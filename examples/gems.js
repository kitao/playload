// @title Gems
// Arrows move; A dashes, B restarts. Collect the gems before time runs out.

const rounds = [
  { gems: 5, seconds: 15 },
  { gems: 7, seconds: 18 },
  { gems: 9, seconds: 21 },
];

let x;
let y;
let gx;
let gy;
let round = 0;
let score = 0;
let collected;
let time;
let dash;
let cooldown;
let state;
let status;

function drawStatus() {
  const seconds = Math.ceil(time / 60);
  const rows = [0, 1];
  const messages = [
    `ROUND ${round + 1}/${rounds.length} GEMS ${collected}/${rounds[round].gems}`,
    `TIME ${seconds}  SCORE ${score}`,
  ];
  if (state === 'PLAY') {
    rows.push(17);
    messages.push(cooldown ? `WAIT ${Math.ceil(cooldown / 60)}  B RESTART` : 'READY  B RESTART');
  }
  for (const [i, message] of messages.entries()) {
    if (status[i] !== message) {
      put(1, rows[i], message.padEnd(18), 7, 1);
      status[i] = message;
    }
  }
}

function placeGem() {
  gx = Math.floor(Math.random() * 20);
  gy = 2 + Math.floor(Math.random() * 14);
  // Keep a new gem far enough away to require another move.
  if (Math.abs(x - gx * 8) < 24 && Math.abs(y - gy * 8) < 24) {
    gx = gx < 10 ? 19 : 0;
  }
  put(gx, gy, '💎', null, 1);
}

function startRound() {
  x = 76;
  y = 68;
  gx = 4;
  gy = 5;
  collected = 0;
  time = rounds[round].seconds * 60;
  dash = 0;
  cooldown = 0;
  state = 'PLAY';
  status = [];

  cls(1);
  put(gx, gy, '💎', null, 1);
  put(1, 16, 'ARROWS MOVE A DASH', 7, 1);
  drawStatus();
  for (let ch = 0; ch < 3; ch++) play(ch, ch === 0 ? 'T240' : '');
}

function reset() {
  round = 0;
  score = 0;
  startRound();
}

function finish(next) {
  state = next;
  const bonus = Math.ceil(time / 60);
  if (next !== 'OVER') score += bonus;
  const messages = {
    CLEAR: [`CLEAR! BONUS +${bonus}`, 'A NEXT  B RESTART'],
    WON: [`ALL CLEAR! +${bonus}`, 'A / B PLAY AGAIN'],
    OVER: ['TIME UP!', 'A / B TRY AGAIN'],
  };
  const [message, hint] = messages[next];
  put(1, 16, ' '.repeat(18), 7, 1);
  put(Math.floor((20 - message.length) / 2), 16, message, next === 'OVER' ? 3 : 6, 1);
  put(1, 17, ' '.repeat(18), 7, 1);
  put(Math.floor((20 - hint.length) / 2), 17, hint, 7, 1);
  drawStatus();
  play(0, next === 'OVER' ? 'T180V12O3N2gec' : 'T180V12O5N2cegC');
}

reset();

function tick() {
  if (btnp(5)) {
    reset();
  } else if (state !== 'PLAY' && btnp(4)) {
    if (state === 'CLEAR') {
      round++;
      startRound();
    } else {
      reset();
    }
  } else if (state === 'PLAY') {
    // At 60 ticks per second, a dash lasts 0.3 seconds and recharges in 1.5.
    if (cooldown > 0) cooldown--;
    if (btnp(4) && cooldown === 0) {
      dash = 18;
      cooldown = 90;
      play(2, 'V10O4N1cG');
    }
    const speed = dash > 0 ? 3 : 1;
    if (dash > 0) dash--;
    x = Math.max(0, Math.min(152, x + (btn(3) - btn(2)) * speed));
    y = Math.max(16, Math.min(120, y + (btn(1) - btn(0)) * speed));
    time--;

    if (Math.abs(x - gx * 8) < 6 && Math.abs(y - gy * 8) < 6) {
      collected++;
      score++;
      put(gx, gy, ' ', 7, 1);
      play(1, 'V12O6N1GC');
      if (collected === rounds[round].gems) {
        finish(round === rounds.length - 1 ? 'WON' : 'CLEAR');
      } else {
        placeGem();
      }
    }
    if (state === 'PLAY' && time === 0) finish('OVER');
    drawStatus();
  }

  spr(x, y, '👾', 6);
}
