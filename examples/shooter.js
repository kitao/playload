// @title Shooter
// ⬅➡ move; hold Ⓐ to fire. Ⓑ starts a new game.

const waves = [
  { rows: 1, columns: 6, speed: 0.4, fireEvery: 96 },
  { rows: 2, columns: 5, speed: 0.5, fireEvery: 80 },
  { rows: 2, columns: 6, speed: 0.6, fireEvery: 64 },
  { rows: 1, columns: 1, speed: 1.2, fireEvery: 40, health: 24 },
];

let wave = 0;
let score = 0;
let lives = 3;
let state;
let x;
let frame;
let direction;
let invincible;
let shotDelay;
let targets;
let shots;
let bullets;
let sparks;

pcg['🚀'].pat = [0x18, 0x3c, 0x24, 0x3c, 0x7e, 0xdb, 0x18, 0x24];
pcg['↑'].pat = '1818181818181800';
pcg['↓'].pat = '0018181818181800';
pcg['·'].col = [1, 0];
// Four 8×8 characters make the final wave's 16×16 boss.
pcg['①'].pat = '0103071f3f7f7f6f';
pcg['②'].pat = '80c0e0f8fcfefef6';
pcg['③'].pat = '7f7f3f1f0f1b3300';
pcg['④'].pat = 'fefefcf8f0d8cc00';

function drawStatus() {
  put(1, 0, `WAVE ${wave + 1}/${waves.length}  ♥${lives}`, 6);
  const boss = wave === waves.length - 1 ? ` BOSS ${targets[0].health}` : '';
  put(1, 1, (`SCORE ${String(score).padStart(4, '0')}` + boss).padEnd(19), 7);
  let instruction = '⬅➡ Ⓐ FIRE Ⓑ RESET';
  if (state !== 'PLAY') {
    instruction = state === 'CLEAR' ? 'Ⓐ NEXT Ⓑ RESET' : 'Ⓐ / Ⓑ PLAY AGAIN';
  }
  put(1, 17, ' '.repeat(18), 7, 0);
  put(Math.floor((20 - instruction.length) / 2), 17, instruction, 7, 0);
}

function startWave() {
  const level = waves[wave];
  x = 76;
  frame = 0;
  direction = 1;
  invincible = 60;
  shotDelay = 0;
  state = 'PLAY';
  shots = [];
  bullets = [];
  sparks = [];
  targets = [];

  for (let row = 0; row < level.rows; row++) {
    for (let column = 0; column < level.columns; column++) {
      targets.push({
        x: (152 - (level.columns - 1) * 20) / 2 + column * 20,
        y: 24 + row * 12,
        row,
        column,
        health: level.health || 1,
        alive: true,
      });
    }
  }

  cls(0);
  for (let i = 0; i < 30; i++) {
    scr[3 + (i % 12)][(i * 7) % 20].chr = '·';
  }
  drawStatus();
  for (let ch = 0; ch < 3; ch++) play(ch, ch === 0 ? 'T240M7' : '');
}

function restart() {
  wave = 0;
  score = 0;
  lives = 3;
  startWave();
}

function finish(nextState) {
  state = nextState;
  shots = [];
  bullets = [];
  drawStatus();
  play(2, '');
  play(0, state === 'OVER' ? 'T180M7V12O3N2gec' : 'T240M7V12O5N2cegC');
}

restart();

function tick() {
  if (btnp(5)) {
    restart();
  }
  if (state !== 'PLAY') {
    if (btnp(4)) {
      if (state === 'CLEAR') {
        wave++;
        startWave();
      } else {
        restart();
      }
    }
  } else {
    const level = waves[wave];
    frame++;
    invincible = Math.max(0, invincible - 1);
    shotDelay = Math.max(0, shotDelay - 1);
    x = Math.max(0, Math.min(152, x + (btn(3) - btn(2)) * 2));

    if (btn(4) && shotDelay === 0 && shots.length < 8) {
      shots.push({ x, y: 112 });
      shotDelay = 12;
      play(1, 'V8O6N1G');
    }

    const alive = targets.filter((target) => target.alive);
    if (
      alive.some(
        (target) =>
          target.x + direction * level.speed < 4 || target.x + direction * level.speed > 148,
      )
    ) {
      direction *= -1;
      for (const target of alive) target.y += 4;
    }
    for (const target of alive) target.x += direction * level.speed;

    // Only the lowest alien in a column fires; later waves aim toward the ship.
    if (frame % level.fireEvery === 0) {
      const front = alive.filter(
        (target) => !alive.some((other) => other.column === target.column && other.y > target.y),
      );
      const target = front[Math.floor(Math.random() * front.length)];
      const aim = wave < 2 ? 0 : Math.max(-0.8, Math.min(0.8, (x - target.x) / 90));
      for (const spread of level.health ? [-0.8, 0, 0.8] : [0]) {
        bullets.push({ x: target.x, y: target.y + (level.health ? 16 : 8), dx: aim + spread });
      }
    }

    for (const shot of shots) {
      shot.y -= 4;
      const hit = alive.find(
        (target) =>
          target.alive &&
          Math.abs(target.x - shot.x) < (level.health ? 10 : 6) &&
          Math.abs(target.y - shot.y) < (level.health ? 10 : 6),
      );
      if (hit) {
        hit.health--;
        hit.alive = hit.health > 0;
        shot.y = -8;
        score += 10;
        sparks.push({ x: hit.x, y: hit.y, time: 12 });
        drawStatus();
        play(2, 'M7V12O4N1gc');
      }
    }
    shots = shots.filter((shot) => shot.y >= 16);

    for (const bullet of bullets) {
      bullet.x += bullet.dx;
      bullet.y += 1.5 + wave * 0.2;
      if (!invincible && Math.abs(bullet.x - x) < 6 && Math.abs(bullet.y - 120) < 6) {
        lives--;
        invincible = 90;
        bullets = [];
        drawStatus();
        play(2, 'M35V10O2N1cM7');
      }
    }
    bullets = bullets.filter((bullet) => bullet.y < 128 && bullet.x > -8 && bullet.x < 160);

    if (
      lives === 0 ||
      alive.some((target) => target.alive && target.y + (level.health ? 16 : 8) >= 120)
    ) {
      finish('OVER');
    } else if (targets.every((target) => !target.alive)) {
      score += lives * 100;
      finish(wave === waves.length - 1 ? 'WON' : 'CLEAR');
    }
  }

  for (const target of targets) {
    if (!target.alive) continue;
    if (waves[wave].health) {
      spr(target.x - 4, target.y, '①②\n③④', 3);
    } else {
      spr(target.x, target.y, '👾', [3, 5, 4][target.row]);
    }
  }
  for (const shot of shots) spr(shot.x, shot.y, '↑', 6);
  for (const bullet of bullets) spr(bullet.x, bullet.y, '↓', 3);
  for (const spark of sparks) {
    spark.time--;
    spr(spark.x, spark.y, '✴', spark.time > 6 ? 6 : 3);
  }
  sparks = sparks.filter((spark) => spark.time > 0);
  if (state !== 'OVER' && (invincible % 8 < 4 || state !== 'PLAY')) spr(x, 120, '🚀', 4);
  if (state !== 'PLAY') {
    const message = { CLEAR: 'WAVE CLEAR', WON: 'ALL WAVES CLEAR', OVER: 'GAME OVER' }[state];
    const left = Math.floor((20 - message.length) / 2) * 8;
    // A solid sprite strip keeps the message above aliens and hit particles.
    spr(left, 64, '█'.repeat(message.length), 0);
    spr(left, 64, message, state === 'OVER' ? 3 : 6);
  }
}
