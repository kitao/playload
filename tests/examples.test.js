import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEngine } from '../src/engine/engine.js';
import { glyphs } from '../src/engine/glyphs.js';
import { compileScore, AY } from '../src/engine/sound.js';
import { encode } from '../src/payload.js';

function exampleEngine() {
  const engine = createEngine(glyphs, compileScore),
    { step, sounds } = engine;
  let recorded = [];
  // Drain each tick just like the worker; keep a separate log for assertions.
  engine.step = (tick) => {
    step(tick);
    recorded.push(...sounds());
  };
  engine.sounds = () => {
    const result = [...recorded, ...sounds()];
    recorded = [];
    return result;
  };
  return engine;
}

async function loadExample(name, hooks, math = Math) {
  const source = await readFile(new URL(`../examples/${name}.js`, import.meta.url), 'utf8');
  const engine = exampleEngine();
  const game = new Function(...Object.keys(engine.api), 'Math', source + '\n' + hooks)(
    ...Object.values(engine.api),
    math,
  );
  const step = (mask = 0, frames = 1) => {
    engine.input(mask);
    for (let i = 0; i < frames; i++) engine.step(game.tick);
  };

  const press = (id) => {
    step();
    step(1 << id);
    step();
  };

  return { source, engine, game, step, press };
}

function pictureRegion(engine, x, y, width, height) {
  const pixels = engine.pixels;
  return Array.from({ length: height }, (_, row) =>
    Array.from(pixels.subarray((y + row) * 160 + x, (y + row) * 160 + x + width)),
  );
}

function expectShooterMessage(engine, text, color) {
  const expected = exampleEngine();
  const column = Math.floor((20 - text.length) / 2);
  expected.api.put(column, 8, text, color, 0);
  assert.deepEqual(
    pictureRegion(engine, column * 8, 64, text.length * 8, 8),
    pictureRegion(expected, column * 8, 64, text.length * 8, 8),
    'The complete result message must remain visible above the game scene.',
  );
}

test('Snake grows, rejects a queued reversal, pauses, loses and restarts', async () => {
  const source = await readFile(new URL('../examples/snake.js', import.meta.url), 'utf8');
  const engine = exampleEngine();
  const math = Object.create(Math);
  math.random = () => 0;
  const game = new Function(
    ...Object.keys(engine.api),
    'Math',
    source +
      '\nreturn {tick,state:()=>({body,food,nextDirection,score,state}),feed:()=>{food={x:9,y:6}}};',
  )(...Object.values(engine.api), math);
  const step = (mask = 0, frames = 1) => {
    engine.input(mask);
    for (let i = 0; i < frames; i++) engine.step(game.tick);
  };
  const press = (id) => {
    step(0);
    step(1 << id);
  };

  step();
  assert.equal(game.state().state, 'READY');
  assert.equal(engine.api.scr[8][9].chr, '●', 'The start prompt must leave the snake visible.');
  assert(
    engine.api.scr[17]
      .map((cell) => cell.chr)
      .join('')
      .includes('A START'),
  );
  game.feed();
  step(1 << 4, 8);
  assert.equal(game.state().score, 1);
  assert.equal(game.state().body.length, 4);
  assert.deepEqual(game.state().body[0], { x: 9, y: 6 });
  assert.equal(engine.api.scr[8][10].chr, '●');
  assert(
    !game
      .state()
      .body.some((cell) => cell.x === game.state().food.x && cell.y === game.state().food.y),
  );
  assert.equal(engine.sounds().filter((command) => command.score.code.length).length, 1);

  step(1 << 0);
  step(1 << 2);
  assert.equal(game.state().nextDirection, 0);
  step(0, 6);
  assert.deepEqual(game.state().body[0], { x: 9, y: 5 });
  press(4);
  assert.equal(game.state().state, 'PAUSED');
  assert(
    engine.api.scr[17]
      .map((cell) => cell.chr)
      .join('')
      .includes('A RESUME'),
  );
  const paused = structuredClone(game.state());
  step(0, 30);
  assert.deepEqual(game.state(), paused);
  press(4);
  step(0, 60);
  assert.equal(game.state().state, 'OVER');
  press(4);
  assert.equal(game.state().state, 'PLAY');
  assert.equal(game.state().body.length, 3);
  press(5);
  assert.equal(game.state().state, 'READY');
  assert.equal(game.state().score, 0);
});

test('Snake permits a vacated tail cell and finishes a full board without searching forever', async () => {
  const source = await readFile(new URL('../examples/snake.js', import.meta.url), 'utf8');
  const engine = exampleEngine();
  const game = new Function(
    ...Object.keys(engine.api),
    source +
      `
return {tick,state:()=>({body,food,state}),fixture:(cells,gem,heading)=>{
  body=cells;food=gem;direction=heading;nextDirection=heading;frame=0;state='PLAY';
}};`,
  )(...Object.values(engine.api));
  const move = () => {
    engine.input(0);
    for (let i = 0; i < 8; i++) engine.step(game.tick);
  };
  const square = [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 2 },
  ];
  game.fixture(structuredClone(square), { x: 0, y: 0 }, 3);
  move();
  assert.equal(game.state().state, 'PLAY');
  assert.deepEqual(game.state().body[0], { x: 3, y: 2 });
  assert.equal(new Set(game.state().body.map((cell) => `${cell.x},${cell.y}`)).size, 4);
  game.fixture([...square, { x: 3, y: 1 }], { x: 0, y: 0 }, 3);
  move();
  assert.equal(game.state().state, 'OVER');

  const cycle = [];
  for (let x = 0; x < 18; x++) cycle.push({ x, y: 0 });
  for (let y = 1; y < 14; y++) {
    for (let i = 0; i < 17; i++) cycle.push({ x: y % 2 ? 17 - i : 1 + i, y });
  }
  for (let y = 13; y >= 1; y--) cycle.push({ x: 0, y });
  game.fixture(cycle.slice(1), cycle[0], 2);
  move();
  assert.equal(game.state().state, 'WON');
  assert.equal(game.state().body.length, 252);
  assert.equal(game.state().food, null);
  move();
  assert.equal(game.state().state, 'WON');
});

const jumpHooks = `return {tick,stages,state:()=>({stage,state,x,y,dy,grounded,jumpBuffer,
  ferry:ferry&&{...ferry},hazard:hazard&&{...hazard},standing:platforms.indexOf(standing)})};`;

test('Jump clears four distinct stages with real movement, including the ferry and patrol', async () => {
  const { engine, game, step, press } = await loadExample('jump', jumpHooks);

  const moveTo = (target) => {
    for (let i = 0; i < 100 && Math.abs(game.state().x - target) > 1; i++) {
      step(1 << (game.state().x < target ? 3 : 2));
      assert.equal(game.state().state, 'PLAY');
    }
    assert(Math.abs(game.state().x - target) <= 1);
  };

  const jumpTo = (target, top) => {
    step();
    step((1 << 4) | (1 << (game.state().x < target ? 3 : 2)));
    for (let i = 0; i < 70; i++) {
      const { x, y, state, grounded } = game.state();
      if (state !== 'PLAY' || (grounded && y === top)) break;
      step(Math.abs(x - target) < 1 ? 0 : 1 << (x < target ? 3 : 2));
    }
    assert.notEqual(game.state().state, 'OVER');
    if (game.state().state === 'PLAY') {
      assert.equal(game.state().grounded, true);
      assert.equal(game.state().y, top);
    } else {
      const [fx, fy] = game.stages[game.state().stage].flag;
      assert(Math.abs(game.state().x - fx * 8) < 7 && Math.abs(game.state().y - fy * 8) < 7);
    }
  };

  const routes = [
    [
      [72, 80],
      [136, 56],
    ],
    [
      [96, 80],
      [56, 56],
      [104, 32],
    ],
    [
      [72, 80],
      [136, 56],
    ],
    [
      [100, 80],
      [120, 56],
      [64, 32],
    ],
  ];

  step();
  engine.sounds();
  for (let stage = 0; stage < routes.length; stage++) {
    assert.equal(game.state().stage, stage);
    if (stage > 0) {
      press(5);
      assert.equal(game.state().stage, stage, 'Retry preserves the current stage.');
    }
    step(0, 240);
    assert.equal(game.state().state, 'PLAY', 'The starting platform must be safe.');
    const [fx, fy] = game.stages[stage].flag;
    assert(
      Array.from({ length: 8 }, (_, y) =>
        engine.pixels.subarray((fy * 8 + y) * 160 + fx * 8, (fy * 8 + y) * 160 + fx * 8 + 8),
      ).some((row) => row.includes(3)),
      'The goal must be visibly red.',
    );
    moveTo([40, 64, 40, 54][stage]);
    for (let i = 0; i < routes[stage].length; i++) {
      jumpTo(...routes[stage][i]);
      if (stage === 2 && i === 0) {
        step(0, 2400);
        assert.equal(game.state().standing, 2, 'The ferry carries the player through reversals.');
        assert.equal(game.state().y, 80);
        for (let n = 0; n < 160 && game.state().x < 102; n++) step();
        assert(game.state().x >= 102);
      }
    }
    if (stage === 0) step(1 << 3, 5);
    assert.equal(game.state().state, stage === 3 ? 'DONE' : 'CLEAR');
    const clear = game.state();
    step(1 << 2, 60);
    assert.deepEqual(game.state(), clear);
    press(4);
    assert.equal(game.state().stage, (stage + 1) % routes.length);
    assert.equal(game.state().state, 'PLAY');
    assert.equal(game.state().dy, 0, 'Advancing must not also trigger a jump.');
  }
  const ay = new AY();
  for (const command of engine.sounds().filter((sound) => sound.score.code.length)) {
    ay.reset();
    ay.play(command.ch, command.score);
    assert(ay.render(12000).some((value) => Math.abs(value) > 0.01));
  }
});

test('Jump retries falls and accepts buffered and coyote jumps without bouncing on held A', async () => {
  const { engine, game, step, press } = await loadExample('jump', jumpHooks);
  step();
  engine.sounds();
  step(1 << 4, 100);
  assert.equal(game.state().grounded, true);
  assert.equal(game.state().y, 104);
  assert.equal(engine.sounds().filter((sound) => sound.score.code.length).length, 1);

  step(1 << 2, 60);
  assert.equal(game.state().state, 'OVER');
  const lost = game.state();
  step(0, 60);
  assert.deepEqual(game.state(), lost);
  press(5);
  assert.deepEqual([game.state().stage, game.state().x, game.state().y], [0, 16, 104]);
  step(1 << 3, 17);
  assert.equal(game.state().grounded, false);
  step((1 << 3) | (1 << 4));
  assert(game.state().dy < 0, 'A jump just beyond the platform edge is accepted.');

  press(5);
  step(1 << 4);
  step(0, 30);
  assert(game.state().dy > 0 && !game.state().grounded);
  step(1 << 4);
  let landed = false;
  let bounced = false;
  for (let i = 0; i < 10; i++) {
    const before = game.state();
    step();
    const after = game.state();
    if (after.grounded) landed = true;
    if (landed && before.grounded && after.dy < 0) bounced = true;
  }
  assert(landed && bounced, 'A press shortly before landing is buffered.');
});

test('Music Box edits notes and rests, plays eight steps, stops and restores them', async () => {
  const source = await readFile(new URL('../examples/music-box.js', import.meta.url), 'utf8');
  const engine = exampleEngine();
  const game = new Function(
    ...Object.keys(engine.api),
    source + '\nreturn {tick,state:()=>({notes,selected,playing,frame})};',
  )(...Object.values(engine.api));

  const press = (id) => {
    engine.input(0);
    engine.step(game.tick);
    engine.input(1 << id);
    engine.step(game.tick);
  };

  engine.step(game.tick);
  const original = game.state().notes.slice();
  assert.equal(game.state().playing, false);
  assert.equal(engine.sounds().length, 0);
  press(2);
  assert.equal(game.state().selected, 0);
  press(0);
  const preview = engine.sounds();
  assert.equal(preview.length, 1);
  assert.equal(preview[0].ch, 1);
  const ay = new AY();
  ay.play(preview[0].ch, preview[0].score);
  assert(ay.render(12000).some((value) => Math.abs(value) > 0.01));

  for (let step = 0; step < 8; step++) {
    assert.equal(game.state().selected, step);
    for (let i = 0; i < 9; i++) press(0);
    assert.equal(game.state().notes[step], 8);
    for (let i = 0; i < 9; i++) press(1);
    assert.equal(game.state().notes[step], 0);
    press(3);
  }
  assert.equal(game.state().selected, 7);
  const restPreview = engine.sounds().at(-1);
  const silence = new AY();
  silence.play(restPreview.ch, restPreview.score);
  assert(silence.render(4800).every((value) => value === 0));
  assert.equal(engine.api.scr[12][17].chr, '–');
  for (let i = 0; i < 7; i++) press(2);
  press(0);
  for (let i = 0; i < 7; i++) press(3);
  engine.sounds();
  press(4);
  const started = engine.sounds();
  assert.equal(started.find((command) => command.ch === 1).score.code.length, 0);
  const score = started.find((command) => command.ch === 0).score;
  assert.equal(score.code.filter((event) => event.op === 'note').length, 8);
  assert.equal(score.code.find((event) => event.op === 'repeat').count, 0);
  for (const command of started) ay.play(command.ch, command.score);
  assert(ay.render(4800).some((value) => Math.abs(value) > 0.01));
  assert.equal(ay.mixer, 7);
  engine.input(0);
  for (let i = 0; i < 30; i++) engine.step(game.tick);
  assert.equal(engine.api.scr[12][5].col[0], 6);
  press(0);
  assert.equal(game.state().frame, 1);
  assert.equal(
    engine
      .sounds()
      .find((command) => command.ch === 0)
      .score.code.filter((event) => event.op === 'note')
      .at(-1).frequency,
    440 * 2 ** ((60 - 69) / 12),
  );
  press(4);
  assert.equal(game.state().playing, false);
  assert(engine.sounds().every((command) => command.score.code.length === 0));
  press(5);
  assert.deepEqual(game.state(), { notes: original, selected: 0, playing: false, frame: 0 });
  assert(engine.pixels.every((col) => col <= 7));
});

test('Gems collects when both coordinate differences are less than six', async () => {
  const source = await readFile(new URL('../examples/gems.js', import.meta.url), 'utf8');
  for (const [dx, dy, collected] of [
    [7, 0, false],
    [6, 0, false],
    [-6, 0, false],
    [0, 6, false],
    [0, -6, false],
    [5, 0, true],
    [-5, 0, true],
    [0, 5, true],
    [0, -5, true],
    [5, 5, true],
    [-5, -5, true],
  ]) {
    const engine = exampleEngine();
    const game = new Function(
      ...Object.keys(engine.api),
      'dx',
      'dy',
      source + '\nx = gx * 8 + dx; y = gy * 8 + dy; return {tick,score:()=>score};',
    )(...Object.values(engine.api), dx, dy);
    engine.sounds();
    engine.step(game.tick);
    assert.equal(game.score(), collected ? 1 : 0, `${dx}, ${dy}`);
    assert.equal(engine.sounds().length, collected ? 1 : 0);
  }
});

const gemsHooks = `return {tick,rounds,state:()=>({round,state,x,y,gx,gy,score,collected,time,dash,cooldown})};`;

test('Gems uses every field cell while keeping collectibles and movement out of the HUD', async () => {
  const math = Object.create(Math);
  let column = 0;
  let row = 0;
  let draws = 0;
  math.random = () => (draws++ % 2 ? (row + 0.5) / 14 : (column + 0.5) / 20);
  const { engine, game, step } = await loadExample(
    'gems',
    'return {tick,placeGem,state:()=>({x,y,gx,gy})};',
    math,
  );
  const cells = new Set();
  for (const [mask, x, y] of [
    [5, 0, 16],
    [10, 152, 120],
  ]) {
    column = 0;
    row = 0;
    step(mask, 200);
    assert.deepEqual([game.state().x, game.state().y], [x, y]);
    for (row = 0; row < 14; row++) {
      for (column = 0; column < 20; column++) {
        game.placeGem();
        const { gx, gy } = game.state();
        assert(gy >= 2 && gy <= 15, 'Collectibles stay between the information rows.');
        assert.equal(engine.api.scr[gy][gx].chr, '💎');
        cells.add(`${gx},${gy}`);
      }
    }
  }
  assert.equal(cells.size, 280, 'A distant pickup can occupy any of the twenty by fourteen cells.');
  assert(
    engine.api.scr[0]
      .map((cell) => cell.chr)
      .join('')
      .includes('ROUND'),
  );
  assert(
    engine.api.scr[16]
      .map((cell) => cell.chr)
      .join('')
      .includes('A DASH'),
  );
});

test('Gems clears three timed rounds, rewards faster play and starts again without background music', async () => {
  for (const random of [0, 0.5, 0.999]) {
    const math = Object.create(Math);
    math.random = () => random;
    const { engine, game, step, press } = await loadExample('gems', gemsHooks, math);
    assert.equal(engine.sounds().length, 3, 'Starting clears all three sound channels.');
    let previousScore = 0;
    for (let round = 0; round < game.rounds.length; round++) {
      let frames = 0;
      while (game.state().state === 'PLAY' && frames++ < 1800) {
        const { x, y, gx, gy, cooldown } = game.state();
        const dx = gx * 8 - x;
        const dy = gy * 8 - y;
        const movement =
          (Math.abs(dx) > 2 ? 1 << (dx > 0 ? 3 : 2) : 0) |
          (Math.abs(dy) > 2 ? 1 << (dy > 0 ? 1 : 0) : 0);
        step(movement | (cooldown === 0 ? 1 << 4 : 0));
        const after = game.state();
        assert(after.x >= 0 && after.x <= 152 && after.y >= 16 && after.y <= 120);
        for (const { score } of engine.sounds()) {
          assert(
            !score.code.some((event) => event.op === 'repeat'),
            'Game effects must be finite.',
          );
        }
      }
      const clear = game.state();
      assert.equal(clear.round, round);
      assert.equal(clear.state, round === 2 ? 'WON' : 'CLEAR');
      assert.equal(clear.collected, game.rounds[round].gems);
      assert.equal(clear.score, previousScore + clear.collected + Math.ceil(clear.time / 60));
      assert.equal(engine.api.scr[clear.gy][clear.gx].chr, ' ');
      previousScore = clear.score;
      step(1 << 3, 60);
      assert.deepEqual(game.state(), clear, 'Time and positions freeze after clearing.');
      press(4);
      assert.equal(game.state().round, (round + 1) % game.rounds.length);
      assert.equal(game.state().dash, 0, 'The next-round input must not also dash.');
      assert.equal(game.state().cooldown, 0);
      assert(
        engine.sounds().every((sound) => !sound.score.code.some((event) => event.op === 'note')),
      );
    }
    assert.equal(game.state().score, 0);
  }
});

test('Gems limits held dash, expires its timer, keeps distant pickups and restarts', async () => {
  const math = Object.create(Math);
  math.random = () => 0.5;
  const { engine, game, step, press } = await loadExample('gems', gemsHooks, math);
  engine.sounds();
  step((1 << 3) | (1 << 4));
  assert.equal(game.state().x, 79);
  assert.equal(game.state().dash, 17);
  assert.equal(game.state().cooldown, 90);
  step(1 << 4, 100);
  assert.equal(game.state().dash, 0);
  assert.equal(game.state().cooldown, 0);
  assert.deepEqual(
    engine.sounds().map((sound) => sound.ch),
    [2],
    'Holding A does not repeat dash.',
  );
  step();
  const before = game.state().x;
  step((1 << 2) | (1 << 4));
  assert.equal(game.state().x, before - 3);

  press(5);
  engine.sounds();
  step((1 << 0) | (1 << 2), 100);
  assert.deepEqual([game.state().x, game.state().y], [0, 16]);
  step((1 << 1) | (1 << 3), 200);
  assert.deepEqual([game.state().x, game.state().y], [152, 120]);
  step(0, game.state().time - 1);
  assert.equal(game.state().state, 'PLAY');
  step();
  assert.equal(game.state().time, 0);
  assert.equal(game.state().state, 'OVER');
  const expired = game.state();
  step(1 << 2, 60);
  assert.deepEqual(game.state(), expired);
  press(4);
  assert.deepEqual(
    [
      game.state().round,
      game.state().score,
      game.state().collected,
      game.state().x,
      game.state().y,
      game.state().state,
    ],
    [0, 0, 0, 76, 68, 'PLAY'],
  );

  // A constant random source must not keep spawning a gem beneath the player.
  const trial = await loadExample('gems', gemsHooks, math);
  for (let i = 0; i < 100 && trial.game.state().collected === 0; i++) {
    const { x, y, gx, gy } = trial.game.state();
    trial.step(
      (Math.abs(x - gx * 8) > 2 ? 1 << (x < gx * 8 ? 3 : 2) : 0) |
        (Math.abs(y - gy * 8) > 2 ? 1 << (y < gy * 8 ? 1 : 0) : 0),
    );
  }
  const { x, y, gx, gy, collected } = trial.game.state();
  assert.equal(collected, 1);
  assert(Math.abs(x - gx * 8) >= 24 || Math.abs(y - gy * 8) >= 24);
  trial.step(0, 60);
  assert.equal(trial.game.state().collected, 1);
});

test('Lights Out solves five distinct boards at their verified minimum, advances and restarts', async () => {
  const { engine, game, step, press } = await loadExample(
    'lights-out',
    'return {tick,puzzles,state:()=>({level,x,y,moves,cleared}),board:()=>board.map(row=>row.map(Number))};',
  );
  const board = game.board;

  const text = (row) =>
    engine.api.scr[row]
      .map((cell) => cell.chr)
      .join('')
      .trim();

  // Any solution is determined by the first row's 32 possible choices.
  function minimumMoves(original) {
    let minimum = 26;
    for (let firstRow = 0; firstRow < 32; firstRow++) {
      const cells = original.map((row) => row.slice());
      let moves = 0;

      function flip(x, y) {
        moves++;
        for (const [dx, dy] of [
          [0, 0],
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ]) {
          if (cells[y + dy]?.[x + dx] !== undefined) cells[y + dy][x + dx] ^= 1;
        }
      }

      for (let x = 0; x < 5; x++) if (firstRow & (1 << x)) flip(x, 0);
      for (let y = 1; y < 5; y++) {
        for (let x = 0; x < 5; x++) if (cells[y - 1][x]) flip(x, y);
      }
      if (cells[4].every((cell) => cell === 0)) minimum = Math.min(minimum, moves);
    }
    return minimum;
  }

  step();
  const boards = new Set();
  for (let level = 0; level < game.puzzles.length; level++) {
    const original = board();
    boards.add(original.flat().join(''));
    assert.equal(game.state().level, level);
    if (level > 0) {
      press(5);
      assert.equal(game.state().level, level, 'Retry preserves the current board.');
      assert.deepEqual(board(), original);
    }
    assert.equal(minimumMoves(original), level + 2);
    assert.equal(game.puzzles[level].length, level + 2);
    assert(text(1).includes(`PAR ${level + 2}`));
    const pixel = (x, y) => engine.pixels[y * 160 + x];
    for (let cy = 0; cy < 5; cy++) {
      for (let cx = 0; cx < 5; cx++) {
        assert.equal(pixel(40 + cx * 20, 32 + cy * 20), original[cy][cx] ? 6 : 0);
        assert.equal(pixel(40 + cx * 20, 24 + cy * 20), original[cy][cx] ? 6 : 4);
      }
    }
    assert.equal(pixel(70, 62), 7, 'The selection corners enclose the selected lamp.');
    press(3);
    assert.equal(pixel(70, 62), 0, 'Moving the selection removes the old corners.');
    assert.equal(pixel(90, 62), 7);
    step(0, 60);
    assert.deepEqual(board(), original, 'Idle ticks must not mutate the puzzle.');

    for (const [tx, ty] of game.puzzles[level]) {
      for (let i = 0; i < 4 && game.state().x !== tx; i++) press(game.state().x < tx ? 3 : 2);
      for (let i = 0; i < 4 && game.state().y !== ty; i++) press(game.state().y < ty ? 1 : 0);
      assert.deepEqual([game.state().x, game.state().y], [tx, ty]);
      press(4);
    }
    assert.equal(game.state().cleared, true);
    assert.equal(game.state().moves, level + 2);
    assert(
      board()
        .flat()
        .every((cell) => cell === 0),
    );
    const clear = game.state();
    step(1 << 3, 60);
    assert.deepEqual(game.state(), clear, 'The solved board must remain solved.');
    assert(
      board()
        .flat()
        .every((cell) => cell === 0),
    );
    if (level === game.puzzles.length - 1) assert.equal(text(16), 'ALL BOARDS CLEAR!');
    press(4);
    assert.equal(game.state().moves, 0, 'Next-board input must not also flip a light.');
  }
  assert.equal(boards.size, 5);
  assert.equal(game.state().level, 0);
  assert.equal(game.state().cleared, false);

  press(4);
  assert.equal(game.state().moves, 1);
  press(5);
  assert.deepEqual(game.state(), { level: 0, x: 2, y: 2, moves: 0, cleared: false });
});

test('Sound FX plays every preset audibly, once per press, and stops', async () => {
  const source = await readFile(new URL('../examples/sound-fx.js', import.meta.url), 'utf8');
  const engine = exampleEngine();
  const game = new Function(...Object.keys(engine.api), source + '\nreturn {tick,effects};')(
    ...Object.values(engine.api),
  );
  engine.step(game.tick);
  assert.equal(engine.sounds().length, 0);
  const ay = new AY();
  for (let i = 0; i < game.effects.length; i++) {
    const displayed = [13, 14]
      .map((row) =>
        engine.api.scr[row]
          .map((cell) => cell.chr)
          .join('')
          .trim(),
      )
      .join('');
    assert.equal(displayed, game.effects[i].sound);
    engine.input(1 << 4);
    engine.step(game.tick);
    const commands = engine.sounds();
    assert.equal(commands.length, 1);
    ay.play(commands[0].ch, commands[0].score);
    assert(
      ay.render(12000).some((value) => Math.abs(value) > 0.01),
      game.effects[i].name,
    );
    assert.equal(ay.mixer, game.effects[i].name === 'HIT' ? 8 : 7);
    engine.step(game.tick);
    assert.equal(engine.sounds().length, 0);
    engine.input(1 << 5);
    engine.step(game.tick);
    const stopped = engine.sounds();
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].score.code.length, 0);
    engine.input(1 << 1);
    engine.step(game.tick);
    engine.input(0);
    engine.step(game.tick);
  }
});

test('Chiptune synchronizes four sections, finishes without looping, stops and restarts', async () => {
  const { engine, game, step, press } = await loadExample(
    'chiptune',
    'return {tick,sections,songTicks,state:()=>({playing,frame})};',
  );
  const commands = engine.sounds();
  assert.deepEqual(
    commands.map((command) => command.ch),
    [0, 1, 2],
  );
  for (const { score } of commands) {
    assert.equal(
      score.code
        .filter((event) => event.op === 'note')
        .reduce((sum, event) => sum + event.beats, 0),
      64,
    );
    assert(!score.code.some((event) => event.op === 'repeat'));
  }
  const ay = new AY();
  for (const command of commands) ay.play(command.ch, command.score);
  const audio = ay.render(48000 * 27);
  assert(audio.some((value) => Math.abs(value) > 0.01));
  assert(audio.every((value) => Number.isFinite(value) && Math.abs(value) < 1));
  assert(audio.subarray(audio.length - 4800).every((value) => Math.abs(value) < 0.001));
  assert(ay.voices.every((voice) => voice === null));
  assert.equal(ay.mixer, 35);

  step();
  for (let section = 1; section < game.sections.length; section++) {
    step(0, section * 384 - game.state().frame);
    assert.equal(game.state().playing, true);
    assert(
      engine.api.scr[4]
        .map((cell) => cell.chr)
        .join('')
        .includes(game.sections[section].name + ' 1/4'),
    );
  }
  step(0, game.songTicks - game.state().frame);
  assert.deepEqual(game.state(), { playing: false, frame: 1536 });
  assert(
    engine.api.scr[4]
      .map((cell) => cell.chr)
      .join('')
      .includes('FINISHED'),
  );
  step(0, 120);
  assert.deepEqual(game.state(), { playing: false, frame: 1536 });
  press(4);
  assert.deepEqual(game.state(), { playing: true, frame: 2 });
  assert(
    engine.api.scr[4]
      .map((cell) => cell.chr)
      .join('')
      .includes('VERSE 1/4'),
  );
  step(0, 400);
  engine.sounds();
  press(4);
  assert.equal(game.state().playing, false);
  assert.equal(engine.sounds().length, 3);
  const stopped = game.state();
  step(0, 60);
  assert.deepEqual(game.state(), stopped);
  press(5);
  assert.deepEqual(game.state(), { playing: true, frame: 2 });
  assert.deepEqual(
    engine.sounds().map((command) => command.ch),
    [0, 1, 2],
  );
  assert(engine.pixels.every((col) => col <= 7));
});

test('Glyph Quest has connected twenty by fourteen dungeons and valid patrol routes', async () => {
  const { engine, game } = await loadExample(
    'glyph-quest',
    'return {levels,start:(level)=>{stage=level;startLevel();}};',
  );
  for (const [stage, level] of game.levels.entries()) {
    game.start(stage);
    const map = level.map.map((row) => [...row]);
    assert.equal(map.length, 14);
    for (const [y, row] of map.entries()) {
      assert.equal(row.length, 20);
      assert.equal(row[0], '#');
      assert.equal(row[19], '#');
      assert.deepEqual(
        engine.api.scr[y + 2].map((cell) => cell.chr),
        row,
        'The visible map must agree with collision coordinates across all twenty columns.',
      );
    }
    const reachable = new Set(['1,1']);
    const queue = [[1, 1]];
    for (const [x, y] of queue) {
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (!map[ny]?.[nx] || map[ny][nx] === '#' || reachable.has(key)) continue;
        reachable.add(key);
        queue.push([nx, ny]);
      }
    }
    for (const [y, row] of map.entries()) {
      for (const [x, tile] of row.entries()) {
        if (tile !== '#')
          assert(reachable.has(`${x},${y}`), `${level.name}: every floor cell must be reachable.`);
      }
    }
    assert(queue.some(([x]) => x === 1));
    assert(queue.some(([x]) => x === 18));
    assert(queue.some(([, y]) => y === 12));
    for (const route of level.patrols) {
      for (const [i, [x, y]] of route.entries()) {
        const [tx, ty] = route[(i + 1) % route.length];
        assert(x === tx || y === ty, 'Patrol segments follow a row or column.');
        const distance = Math.abs(tx - x) + Math.abs(ty - y);
        for (let step = 0; step <= distance; step++) {
          const cx = x + Math.sign(tx - x) * step;
          const cy = y + Math.sign(ty - y) * step;
          assert(reachable.has(`${cx},${cy}`), 'Patrols stay on reachable floor.');
        }
      }
    }
  }
});

test('Glyph Quest clears three guarded dungeons through recorded real inputs', async () => {
  const { source, engine, game, step } = await loadExample(
    'glyph-quest',
    'return {tick,state:()=>structuredClone({stage,state,map,enemies,x,y,gems,total,ring,cooldown})};',
  );
  // Recorded real controller inputs, encoded as mask:ticks. No state is injected.
  const routes = [
    '0:1200 8:7 2:14 8:7 2:42 4:7 2:21 8:35 1:7 8:21 2:7 8:28 1:7 8:7 1:35 ' +
      '4:14 1:7 4:7 1:28 4:14 8:21 24:7 8:28 2:77 0:1 16:1 0:1',
    '0:1200 8:77 2:7 18:7 2:21 4:21 2:14 8:14 4:7 2:28 4:49 1:7 4:14 1:35 ' +
      '2:14 8:21 24:7 8:14 1:28 8:35 1:21 8:42 2:14 4:7 8:7 2:21 4:7 2:14 8:7 2:28 0:1 16:1 0:1',
    '0:1200 2:35 8:21 1:14 8:7 1:7 8:42 2:35 4:21 2:14 8:14 2:14 8:7 1:56 8:14 ' +
      '1:21 8:35 2:35 4:35 2:14 8:14 24:7 8:14 2:28 0:1 16:1 0:1',
  ];

  for (let stage = 0; stage < routes.length; stage++) {
    assert.equal(game.state().stage, stage);
    if (stage > 0) {
      step(1 << 5);
      step();
      assert.equal(game.state().stage, stage, 'Retry preserves the current dungeon.');
    }
    assert.equal(game.state().total, [6, 6, 7][stage]);
    assert.equal(game.state().enemies.length, stage + 2);
    let cleared = false;
    const inputs = routes[stage].split(' ').map((move) => move.split(':').map(Number));
    for (const [mask, frames] of inputs) {
      for (let i = 0; i < frames; i++) {
        const before = game.state();
        step(mask);
        const after = game.state();
        assert.notEqual(after.state, 'CAUGHT');
        assert.notEqual(after.map[after.y][after.x], '#');
        assert(after.enemies.every((enemy) => after.map[enemy.y][enemy.x] !== '#'));
        if (before.stage === after.stage) {
          assert(Math.abs(before.x - after.x) + Math.abs(before.y - after.y) <= 1);
        }
        if (after.state === 'CLEAR') {
          cleared = true;
          assert.equal(after.gems, after.total);
          assert.equal(after.ring, true);
          assert(!engine.pixels.includes(3), 'Clearing removes the red enemy sprites.');
          assert(
            !engine.api.scr[17]
              .map((cell) => cell.chr)
              .join('')
              .includes('READY'),
          );
        }
        if (before.state === 'CLEAR' && after.state === 'PLAY') {
          assert.equal(after.stage, (stage + 1) % routes.length);
          assert.equal(after.cooldown, 0, 'Advancing must not also use stun.');
        }
      }
    }
    assert(cleared, 'The recorded controller route must clear this dungeon.');
  }
  assert.deepEqual([game.state().stage, game.state().gems, game.state().ring], [0, 0, false]);
  assert((await encode(source)).bytes <= 3000);
});

test('Glyph Quest catches crossing paths, permits stunned passage and restores items on retry', async () => {
  const hooks = 'return {tick,state:()=>({stage,state,x,y,gems,ring,cooldown,enemies})};';
  for (const stun of [false, true]) {
    const { engine, game, step, press } = await loadExample('glyph-quest', hooks);
    step(0, 22);
    step(1 << 1, 34);
    step(1 << 3, 14);
    step(0, 83);
    step((1 << 3) | (stun ? 1 << 4 : 0));
    assert.equal(game.state().state, stun ? 'PLAY' : 'CAUGHT');
    if (stun) {
      assert(game.state().enemies.some((enemy) => enemy.stun > 0));
      assert.equal(game.state().cooldown, 90);
      step(1 << 0, 28);
      step(0, 90);
      assert.equal(game.state().state, 'PLAY');
      assert.equal(game.state().cooldown, 0);
      assert(game.state().enemies.every((enemy) => enemy.stun === 0));
    } else {
      assert(
        !engine.api.scr[17]
          .map((cell) => cell.chr)
          .join('')
          .includes('READY'),
      );
      const caught = structuredClone(game.state());
      step(1 << 3, 60);
      assert.deepEqual(game.state(), caught);
    }
    press(5);
    assert.deepEqual(
      [
        game.state().stage,
        game.state().x,
        game.state().y,
        game.state().gems,
        game.state().ring,
        game.state().cooldown,
        game.state().state,
      ],
      [0, 1, 1, 0, false, 0, 'PLAY'],
    );
    assert.equal(engine.api.scr[5][2].chr, '💎');
  }
});

test('Glyph Quest starts each dungeon silently at the same effects tempo', async () => {
  const { engine, game } = await loadExample(
    'glyph-quest',
    'return {tick,start:(level)=>{stage=level;startLevel();}};',
  );
  const ay = new AY();
  engine.sounds();
  for (const [stage, tempo] of [120, 240, 150].entries()) {
    ay.play(0, compileScore(`T${tempo}M35O3N5c`));
    ay.sample();
    ay.play(1, compileScore('O6N5g'));
    ay.play(2, compileScore('O4N5e'));
    game.start(stage);
    for (const command of engine.sounds()) ay.play(command.ch, command.score);
    ay.sample();
    assert.equal(ay.tempo, 240);
    assert.equal(ay.mixer, 7);
    assert(ay.voices.every((voice) => voice === null));
  }
});

test('Shooter wins four waves through movement and fire, including a multi-hit boss', async () => {
  for (const random of [0.05, 0.8]) {
    const math = Object.create(Math);
    math.random = () => random;
    const { source, engine, game, step, press } = await loadExample(
      'shooter',
      'return {tick,waves,state:()=>({wave,state,x,targets,bullets,shots,direction,score,lives,frame})};',
      math,
    );
    step();
    const shipPixels = [];
    for (let y = 120; y < 128; y++)
      shipPixels.push(...engine.pixels.subarray(y * 160 + 76, y * 160 + 84));
    assert(shipPixels.includes(4));
    const completed = [];
    let frames = 0;
    let sawBoss = false;
    while (frames < 6000 && !['WON', 'OVER'].includes(game.state().state)) {
      const { wave, state, x, targets, bullets, direction } = game.state();
      if (state === 'CLEAR') {
        completed.push(wave);
        assert(targets.every((target) => !target.alive));
        assert.equal(game.state().shots.length, 0);
        assert.equal(bullets.length, 0);
        const frozen = structuredClone(game.state());
        step(0, 60);
        assert.deepEqual(game.state(), frozen);
        press(4);
        assert.equal(game.state().wave, wave + 1);
        assert.equal(game.state().shots.length, 0);
        continue;
      }
      if (wave === 3 && !sawBoss) {
        sawBoss = true;
        assert.equal(targets.length, 1);
        assert.equal(targets[0].health, 24);
      }

      // Follow a moving target's predicted position, dodging incoming shots.
      const alive = targets.filter((target) => target.alive);
      const target = alive.reduce((a, b) => (Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b));
      let goal = target.x + direction * game.waves[wave].speed * Math.max(0, (112 - target.y) / 4);
      const danger = bullets.some(
        (bullet) =>
          bullet.y > 88 &&
          bullet.y < 128 &&
          Math.abs(bullet.x + (bullet.dx * (120 - bullet.y)) / (1.5 + wave * 0.2) - x) < 9,
      );
      if (danger) goal = x < 76 ? x + 20 : x - 20;
      goal = Math.max(0, Math.min(152, goal));
      step((1 << 4) | (goal > x + 1 ? 1 << 3 : goal < x - 1 ? 1 << 2 : 0));
      frames++;
      assert(game.state().shots.length <= 8);
      assert(game.state().x >= 0 && game.state().x <= 152);
    }
    assert.deepEqual(completed, [0, 1, 2]);
    assert(sawBoss);
    assert.equal(game.state().state, 'WON');
    assert(game.state().lives > 0);
    assert.equal(game.state().targets[0].health, 0);
    expectShooterMessage(engine, 'ALL WAVES CLEAR', 6);
    const won = structuredClone(game.state());
    step(1 << 2, 60);
    assert.deepEqual(game.state(), won);
    assert(engine.pixels.every((col) => col <= 7));
    press(4);
    assert.equal(game.state().wave, 0);
    assert.equal(game.state().score, 0);
    assert.equal(game.state().lives, 3);
    assert.equal(game.state().state, 'PLAY');
    const payload = await encode(source);
    assert(payload.bytes <= 3000);
  }
});

test('Shooter removes hits immediately, grants damage recovery, loses and restarts', async () => {
  const { engine, game, step, press } = await loadExample(
    'shooter',
    `return {tick,state:()=>({x,score,lives,state,invincible,targets,bullets}),
      shot:()=>{shots=[{x:targets[0].x+direction*waves[wave].speed,y:targets[0].y+4}];},
      hit:()=>{bullets=Array.from({length:3},()=>({x,y:118.5,dx:0}));},
      expose:()=>{invincible=0;},invade:()=>{for(const target of targets) target.y=112;}};`,
  );
  step();
  engine.sounds();
  game.shot();
  step();
  const target = game.state().targets[0];
  assert.equal(target.alive, false);
  assert.equal(game.state().score, 10);
  for (let y = target.y; y < target.y + 8; y++) {
    const left = y * 160 + Math.floor(target.x);
    assert(
      !engine.pixels.subarray(left, left + 8).includes(3),
      'The alien disappears on the hit frame.',
    );
  }
  game.expose();
  game.hit();
  step();
  assert.equal(game.state().lives, 2, 'Overlapping bullets consume one life.');
  assert.equal(game.state().bullets.length, 0);
  for (let i = 0; i < 89; i++) {
    game.hit();
    step();
    assert.equal(game.state().lives, 2);
  }
  game.hit();
  step();
  assert.equal(game.state().lives, 1);
  game.expose();
  game.hit();
  step();
  assert.equal(game.state().state, 'OVER');
  assert.equal(game.state().lives, 0);
  assert(!engine.pixels.includes(4), 'A destroyed ship is no longer drawn.');
  const lost = structuredClone(game.state());
  step(1 << 3, 60);
  assert.deepEqual(game.state(), lost);
  press(5);
  assert.equal(game.state().state, 'PLAY');
  assert.equal(game.state().score, 0);
  assert.equal(game.state().lives, 3);
  assert.equal(game.state().x, 76);
  game.invade();
  step();
  assert.equal(game.state().state, 'OVER', 'An alien reaching the ship row ends the game.');
  press(4);
  assert.equal(game.state().state, 'PLAY');
});

test('Shooter keeps shots out of the information rows and result messages above the scene', async () => {
  const { engine, game, step, press } = await loadExample(
    'shooter',
    `return {tick,finish,state:()=>({state,shots,bullets}),
      crossHUD:()=>{shots=[{x:24,y:17}];bullets=[{x:24,y:133,dx:0}];},
      die:()=>{targets=[{x:40,y:64,row:0,column:0,health:1,alive:true}];
        lives=1;invincible=0;bullets=[{x,y:114,dx:0}];},
      overlap:()=>{targets[0].x=40;targets[0].y=64;sparks=[{x:40,y:64,time:12}];}};`,
  );
  step();
  const top = pictureRegion(engine, 0, 0, 160, 16);
  const bottom = pictureRegion(engine, 0, 136, 160, 8);
  game.crossHUD();
  step();
  assert.equal(game.state().shots.length, 0);
  assert.equal(game.state().bullets.length, 0);
  assert.deepEqual(pictureRegion(engine, 0, 0, 160, 16), top);
  assert.deepEqual(pictureRegion(engine, 0, 136, 160, 8), bottom);
  game.die();
  step();
  assert.equal(game.state().state, 'OVER');
  expectShooterMessage(engine, 'GAME OVER', 3);
  for (const [state, text] of [
    ['CLEAR', 'WAVE CLEAR'],
    ['WON', 'ALL WAVES CLEAR'],
  ]) {
    press(5);
    game.overlap();
    game.finish(state);
    step();
    expectShooterMessage(engine, text, 6);
  }
});

test('Shooter fires immediately on a tap, repeats at a fixed rate and respects the shot cap', async () => {
  const { engine, game, step } = await loadExample(
    'shooter',
    'return {tick,state:()=>({shots}),fill:()=>{shots=Array.from({length:8},()=>({x:0,y:112}));}};',
  );
  engine.sounds();
  game.fill();
  step(1 << 4);
  assert.equal(game.state().shots.length, 8);
  assert.equal(engine.sounds().length, 0);
  step(0, 31);
  assert.equal(game.state().shots.length, 0);
  step(1 << 4);
  assert.equal(game.state().shots.length, 1);
  assert.equal(engine.sounds().length, 1);
  step(1 << 4, 11);
  assert.equal(game.state().shots.length, 1);
  assert.equal(engine.sounds().length, 0);
  step(1 << 4);
  assert.equal(game.state().shots.length, 2);
  assert.equal(engine.sounds().length, 1);
});

test('Shooter restores tone and tempo after damage, interruptions and restarts', async () => {
  const math = Object.create(Math);
  math.random = () => 0;
  const { engine, game, step } = await loadExample(
    'shooter',
    `return {tick,finish,state:()=>({lives,wave}),
      hit:()=>{invincible=0;bullets=[{x,y:118.5,dx:0}];},
      kill:()=>{shots=[{x:targets[0].x+direction*waves[wave].speed,y:targets[0].y+4}];}};`,
    math,
  );
  const ay = new AY();

  const advance = (mask = 0, frames = 1) => {
    for (let i = 0; i < frames; i++) {
      step(mask);
      for (const command of engine.sounds()) ay.play(command.ch, command.score);
      ay.render(800);
    }
  };

  advance(0, 96);
  assert.equal(ay.tempo, 240);
  advance(1 << 2, 23);
  for (let i = 0; i < 32 && game.state().lives === 3; i++) advance();
  assert.equal(game.state().lives, 2, 'Real movement leads into an enemy bullet.');
  assert.equal(ay.mixer, 35, 'Damage adds noise only to channel 2.');
  advance(1 << 4);
  assert(ay.voices[1]?.sounding, 'Firing still has a tone during damage.');
  assert(ay.mixer & 2);
  advance(0, 8);
  assert.equal(ay.mixer, 7, 'The finished damage effect restores tone.');

  game.hit();
  advance();
  assert.equal(ay.mixer, 35);
  game.kill();
  advance();
  assert.equal(ay.mixer, 7, 'A kill can interrupt damage without leaving noise enabled.');
  game.hit();
  advance();
  assert.equal(ay.tempo, 180);
  assert.equal(ay.mixer, 7, 'The loss melody also restores tone.');
  advance(1 << 5);
  assert.equal(ay.tempo, 240);
  assert(ay.voices.every((voice) => voice === null));
  advance(1 << 4);
  assert(ay.voices[1]?.sounding);
  advance(0, 4);
  assert.equal(ay.voices[1], null, 'A restarted shot remains shorter than 100 ms.');

  game.finish('CLEAR');
  advance();
  advance(1 << 4);
  assert.equal(game.state().wave, 1);
  assert.equal(ay.tempo, 240);
  assert.equal(ay.mixer, 7);
  assert(ay.voices.every((voice) => voice === null));
});

test('Shooter clears shrinking boss HP and measures invasion using its full height', async () => {
  const { engine, game, step } = await loadExample(
    'shooter',
    `return {tick,state:()=>({state,targets}),boss:()=>{wave=3;startWave();score=1030;
      targets[0].health=10;drawStatus();},shot:()=>{shots=[{
      x:targets[0].x+direction*waves[wave].speed,y:targets[0].y+4}];},
      descend:(y)=>{targets[0].y=y;}};`,
  );
  game.boss();
  game.shot();
  step();
  assert.equal(game.state().targets[0].health, 9);
  assert.equal(
    engine.api.scr[1]
      .map((cell) => cell.chr)
      .join('')
      .trim(),
    'SCORE 1040 BOSS 9',
  );
  game.descend(103);
  step();
  assert.equal(game.state().state, 'PLAY');
  game.descend(104);
  step();
  assert.equal(game.state().state, 'OVER', 'The 16-pixel boss reaches the ship row at y=104.');
});

test('long Music Box editing drains each tick while retaining the complete sound log', async () => {
  const { engine, press } = await loadExample('music-box', 'return { tick };');
  for (let i = 0; i < 300; i++) press(i % 2 ? 1 : 0);
  assert.equal(engine.sounds().length, 300);
  assert.deepEqual(engine.sounds(), []);
});
