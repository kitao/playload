import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEngine } from '../src/engine.js';
import { glyphs } from '../src/glyphs.js';
import { compileScore, AY } from '../src/sound.js';
import { encode, gameURL } from '../src/payload.js';

test('Snake grows, rejects a queued reversal, pauses, loses and restarts', async () => {
  const source = await readFile(new URL('../examples/snake.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const math = Object.create(Math);
  math.random = () => 0;
  const game = new Function(
    ...Object.keys(engine.api),
    'Math',
    source +
      '\nreturn {tick,state:()=>({body,food,nextDirection,score,state}),feed:()=>{food={x:9,y:5}}};',
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
  game.feed();
  step(1 << 4, 8);
  assert.equal(game.state().score, 1);
  assert.equal(game.state().body.length, 4);
  assert.deepEqual(game.state().body[0], { x: 9, y: 5 });
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
  assert.deepEqual(game.state().body[0], { x: 9, y: 4 });
  press(4);
  assert.equal(game.state().state, 'PAUSED');
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
  const engine = createEngine(glyphs, compileScore);
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
  for (let y = 1; y < 12; y++) {
    for (let i = 0; i < 17; i++) cycle.push({ x: y % 2 ? 17 - i : 1 + i, y });
  }
  for (let y = 11; y >= 1; y--) cycle.push({ x: 0, y });
  game.fixture(cycle.slice(1), cycle[0], 2);
  move();
  assert.equal(game.state().state, 'WON');
  assert.equal(game.state().body.length, 216);
  assert.equal(game.state().food, null);
  move();
  assert.equal(game.state().state, 'WON');
});

test('Jump reaches a visible flag, lands on platforms, falls and resets', async () => {
  const source = await readFile(new URL('../examples/jump.js', import.meta.url), 'utf8');
  const fresh = () => {
    const engine = createEngine(glyphs, compileScore);
    const game = new Function(
      ...Object.keys(engine.api),
      source +
        `
return {tick,platforms,state:()=>({x,y,dy,grounded,won,lost}),place:(px,py,velocity)=>{
  x=px;y=py;dy=velocity;grounded=false;won=false;lost=false;
}};`,
    )(...Object.values(engine.api));
    const step = (mask = 0, frames = 1) => {
      engine.input(mask);
      for (let i = 0; i < frames; i++) engine.step(game.tick);
    };
    step();
    engine.sounds();
    return { engine, game, step };
  };
  const { engine, game, step } = fresh();
  const flag = [];
  for (let y = 32; y < 40; y++) flag.push(...engine.pixels.subarray(y * 160 + 136, y * 160 + 144));
  assert(flag.includes(3), 'The goal must be visibly red.');
  for (const [tx, ty] of [
    [64, 80],
    [112, 56],
    [76, 40],
    [136, 32],
  ]) {
    step();
    step((1 << 4) | (1 << (game.state().x < tx ? 3 : 2)));
    for (
      let i = 0;
      i < 70 && !game.state().grounded && !game.state().won && !game.state().lost;
      i++
    ) {
      const { x } = game.state();
      step(x < tx ? 1 << 3 : x > tx ? 1 << 2 : 0);
    }
    assert.equal(game.state().grounded, true);
    assert.equal(game.state().y, ty);
    assert.equal(game.state().lost, false);
  }
  for (let i = 0; i < 20 && !game.state().won; i++) step(1 << 3);
  assert.equal(game.state().won, true);
  const won = game.state();
  step((1 << 2) | (1 << 4), 60);
  assert.deepEqual(game.state(), won);
  const ay = new AY();
  for (const command of engine.sounds()) {
    ay.reset();
    ay.play(command.ch, command.score);
    assert(ay.render(12000).some((value) => Math.abs(value) > 0.01));
  }
  step(1 << 5);
  assert.deepEqual(game.state(), { x: 16, y: 104, dy: 0, grounded: true, won: false, lost: false });
  assert(engine.sounds().every((command) => command.score.code.length === 0));

  for (const platform of game.platforms) {
    const trial = fresh();
    const top = platform.y * 8;
    trial.game.place(platform.x * 8, top + 2, -4.5);
    trial.step();
    assert.equal(trial.game.state().grounded, false);
    assert(trial.game.state().dy < 0);
    for (let i = 0; i < 60 && !trial.game.state().grounded; i++) trial.step();
    assert.equal(trial.game.state().y, top - 8);
    trial.step(0, 90);
    assert.equal(trial.game.state().y, top - 8);
  }
  step(1 << 4, 100);
  assert.equal(engine.sounds().length, 1, 'Holding jump must not bounce repeatedly.');
  assert.equal(game.state().y, 104);
  step(1 << 2, 60);
  assert.equal(game.state().lost, true);
  assert(!engine.pixels.includes(6), 'The fallen player must not be drawn.');
  const lost = game.state();
  step((1 << 3) | (1 << 4), 60);
  assert.deepEqual(game.state(), lost);
  step(1 << 5);
  assert.equal(game.state().lost, false);
  assert.equal(game.state().y, 104);
});

test('Music Box edits all eight steps, plays the melody, stops and restores it', async () => {
  const source = await readFile(new URL('../examples/music-box.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
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
    assert.equal(game.state().notes[step], 7);
    for (let i = 0; i < 9; i++) press(1);
    assert.equal(game.state().notes[step], 0);
    press(3);
  }
  assert.equal(game.state().selected, 7);
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
  assert.equal(engine.api.scr[12][6].col[0], 6);
  press(0);
  assert.equal(game.state().frame, 1);
  assert.equal(
    engine
      .sounds()
      .find((command) => command.ch === 0)
      .score.code.filter((event) => event.op === 'note')
      .at(-1).frequency,
    440 * 2 ** ((62 - 69) / 12),
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
    const engine = createEngine(glyphs, compileScore);
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

test('Gems draws coordinates once even when its next position overlaps the player', async () => {
  const source = await readFile(new URL('../examples/gems.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const math = Object.create(Math);
  const values = [0.5, 0.5, 0.5, 0.5, 0, 0];
  let next = 0;
  math.random = () => values[next++ % values.length];
  const game = new Function(
    ...Object.keys(engine.api),
    'Math',
    source + '\nx = 72; y = 72; gx = 9; gy = 9; return {tick,state:()=>({x,y,gx,gy,score})};',
  )(...Object.values(engine.api), math);
  const step = (mask, frames) => {
    engine.input(mask);
    for (let i = 0; i < frames; i++) engine.step(game.tick);
  };
  engine.sounds();
  for (let score = 1; score <= 2; score++) {
    step(0, 1);
    assert.deepEqual(game.state(), { x: 72, y: 72, gx: 9, gy: 9, score });
    assert.equal(next, score * 2);
    assert.deepEqual(
      engine.sounds().map((sound) => sound.ch),
      [1],
    );
  }
  step(0, 1);
  assert.deepEqual(game.state(), { x: 72, y: 72, gx: 1, gy: 3, score: 3 });
  assert.equal(next, 6);
  engine.sounds();
  step(0, 60);
  assert.equal(game.state().score, 3);
  assert.equal(engine.sounds().length, 0);
  next = 0;
  step(1 << 5, 1);
  assert.deepEqual(game.state(), { x: 72, y: 72, gx: 9, gy: 9, score: 3 });
  assert.equal(next, 2);
  assert.deepEqual(
    engine.sounds().map((sound) => sound.ch),
    [2],
  );
  step(0, 1);
  assert.equal(game.state().score, 4);
  assert.equal(next, 4);
  assert.deepEqual(
    engine.sounds().map((sound) => sound.ch),
    [1],
  );
});

test('Gems demonstrates held movement, collection, sound effects and relocation', async () => {
  const source = await readFile(new URL('../examples/gems.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const math = Object.create(Math);
  math.random = () => 0.5;
  const game = new Function(
    ...Object.keys(engine.api),
    'Math',
    source + '\nreturn {tick,state:()=>({x,y,gx,gy,score})};',
  )(...Object.values(engine.api), math);
  assert.equal(engine.sounds()[0].ch, 0);
  engine.input((1 << 3) | (1 << 4));
  engine.step(game.tick);
  assert.equal(game.state().x, 78);
  engine.input(1 << 2);
  for (let i = 0; i < 42; i++) engine.step(game.tick);
  engine.input(1 << 0);
  for (let i = 0; i < 24; i++) engine.step(game.tick);
  assert.equal(game.state().score, 1);
  assert.deepEqual([game.state().gx, game.state().gy], [9, 9]);
  assert.deepEqual(
    engine.sounds().map((sound) => sound.ch),
    [1],
  );
  engine.input(1 << 5);
  engine.step(game.tick);
  assert.equal(game.state().score, 1);
  assert.deepEqual(
    engine.sounds().map((sound) => sound.ch),
    [2],
  );
  engine.step(game.tick);
  assert.equal(engine.sounds().length, 0);
  engine.input((1 << 0) | (1 << 2));
  for (let i = 0; i < 200; i++) engine.step(game.tick);
  assert.deepEqual([game.state().x, game.state().y], [8, 24]);
  engine.input((1 << 1) | (1 << 3));
  for (let i = 0; i < 200; i++) engine.step(game.tick);
  assert.deepEqual([game.state().x, game.state().y], [144, 112]);
});

test('Lights Out retains its screen-cell board, solves, and resets', async () => {
  const source = await readFile(new URL('../examples/lights-out.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const game = new Function(
    ...Object.keys(engine.api),
    source + '\nreturn {tick,state:()=>({x,y,moves})};',
  )(...Object.values(engine.api));
  const board = () =>
    Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 5 }, (_, x) => engine.api.scr[4 + y * 2][6 + x * 2].chr),
    );
  const press = (id) => {
    engine.input(1 << id);
    engine.step(game.tick);
    engine.input(0);
    engine.step(game.tick);
  };
  engine.step(game.tick);
  const original = board();
  assert(original.flat().includes('●'));
  assert.deepEqual(engine.api.scr[8][10].col, [null, 1]);
  press(3);
  assert.deepEqual(engine.api.scr[8][10].col, [null, null]);
  assert.deepEqual(engine.api.scr[8][12].col, [null, 1]);
  for (let i = 0; i < 60; i++) engine.step(game.tick);
  assert.deepEqual(board(), original);
  for (const [tx, ty] of [
    [0, 0],
    [1, 3],
    [4, 2],
    [2, 2],
  ]) {
    const dx = tx - game.state().x,
      dy = ty - game.state().y;
    for (let i = 0; i < Math.abs(dx); i++) press(dx > 0 ? 3 : 2);
    for (let i = 0; i < Math.abs(dy); i++) press(dy > 0 ? 1 : 0);
    assert.deepEqual([game.state().x, game.state().y], [tx, ty]);
    press(4);
  }
  assert.equal(game.state().moves, 4);
  assert(
    board()
      .flat()
      .every((chr) => chr === '○'),
  );
  assert.equal(
    engine.api.scr[1]
      .map((cell) => cell.chr)
      .join('')
      .trim(),
    'ALL CLEAR!',
  );
  assert.equal(engine.sounds().filter((sound) => sound.score.code.length).length, 4);
  press(5);
  assert.deepEqual(game.state(), { x: 2, y: 2, moves: 0 });
  assert.deepEqual(board(), original);
  assert(engine.sounds().every((sound) => sound.score.code.length === 0));
});

test('Sound FX plays every preset audibly, once per press, and stops', async () => {
  const source = await readFile(new URL('../examples/sound-fx.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const game = new Function(...Object.keys(engine.api), source + '\nreturn {tick,effects};')(
    ...Object.values(engine.api),
  );
  engine.step(game.tick);
  assert.equal(engine.sounds().length, 0);
  const ay = new AY();
  for (let i = 0; i < game.effects.length; i++) {
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

test('the chiptune example plays three valid voices and supports stop and restart', async () => {
  const source = await readFile(new URL('../examples/chiptune.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const tick = new Function(...Object.keys(engine.api), source + '\nreturn tick;')(
    ...Object.values(engine.api),
  );
  engine.step(tick);
  const commands = engine.sounds();
  assert.deepEqual(
    commands.map((command) => command.ch),
    [0, 1, 2],
  );
  const ay = new AY();
  for (const command of commands) ay.play(command.ch, command.score);
  assert(ay.render(4800).some((value) => Math.abs(value) > 0.01));
  assert.equal(ay.mixer, 35);
  assert(engine.pixels.some((value) => value !== 0));
  assert(engine.pixels.every((value) => value <= 7));
  engine.input(1 << 4);
  engine.step(tick);
  const stopped = engine.sounds();
  assert.deepEqual(
    stopped.map((command) => command.ch),
    [0, 1, 2],
  );
  assert(stopped.every((command) => command.score.code.length === 0));
  engine.input(0);
  engine.step(tick);
  assert.deepEqual(engine.sounds(), []);
  engine.input(1 << 5);
  engine.step(tick);
  assert.deepEqual(
    engine.sounds().map((command) => command.ch),
    [0, 1, 2],
  );
  const payload = await encode(source);
  assert(payload.bytes <= 3072);
  assert(gameURL('https://example.com/playload/', payload.hash).length <= 4096);
});

test('the pictogram dungeon can collect every item, win, and reset through the public API', async () => {
  const source = await readFile(new URL('../examples/glyph-quest.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const game = new Function(
    ...Object.keys(engine.api),
    source + '\nreturn {tick,map,state:()=>({x,y,gems,ring,won})};',
  )(...Object.values(engine.api));
  const directions = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  function walkTo(tx, ty) {
    const { x, y } = game.state();
    const queue = [[x, y, []]],
      seen = new Set([x + ',' + y]);
    let path;
    for (let i = 0; i < queue.length; i++) {
      const [px, py, moves] = queue[i];
      if (px === tx && py === ty) {
        path = moves;
        break;
      }
      directions.forEach(([dx, dy], button) => {
        const nx = px + dx,
          ny = py + dy,
          k = nx + ',' + ny;
        if (game.map[ny]?.[nx] && game.map[ny][nx] !== '#' && !seen.has(k)) {
          seen.add(k);
          queue.push([nx, ny, [...moves, button]]);
        }
      });
    }
    assert(path, 'item is unreachable: ' + tx + ',' + ty);
    for (const button of path) {
      engine.input(1 << button);
      for (let i = 0; i < 7; i++) engine.step(game.tick);
    }
    assert.deepEqual([game.state().x, game.state().y], [tx, ty]);
  }
  const items = [];
  game.map.forEach((row, y) =>
    row.forEach((tile, x) => {
      if (tile === '💎' || tile === '💍') items.push([x, y]);
    }),
  );
  assert.equal(items.length, 7);
  for (const [x, y] of items) walkTo(x, y);
  assert.equal(game.state().gems, 6);
  assert.equal(game.state().ring, true);
  assert.equal(engine.sounds().filter((s) => s.ch === 1).length, 7);
  walkTo(16, 10);
  assert.equal(game.state().won, true);
  assert.deepEqual(
    engine.sounds().map((s) => s.ch),
    [0, 2],
  );
  engine.input(1 << 4);
  engine.step(game.tick);
  assert.deepEqual(game.state(), { x: 1, y: 1, gems: 0, ring: false, won: false });
  assert(engine.sounds().every((s) => s.score.code.length === 0));
  assert((await encode(source)).bytes <= 3072);
});

test('the shooter moves by pixels, removes hit targets in the same frame, and resets', async () => {
  const source = await readFile(new URL('../examples/shooter.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const game = new Function(
    ...Object.keys(engine.api),
    source + '\nreturn {tick,state:()=>({x,score,shots,targets})};',
  )(...Object.values(engine.api));
  engine.step(game.tick);
  const shipPixels = [];
  for (let y = 120; y < 128; y++) {
    shipPixels.push(...engine.pixels.subarray(y * 160 + 76, y * 160 + 84));
  }
  assert(shipPixels.includes(4), 'The custom ship must be visible in blue at its spawn position.');

  const fire = () => {
    const target = game
      .state()
      .targets.find((target) => target.alive && target.x === game.state().x);
    assert(target);
    engine.input(1 << 4);
    engine.step(game.tick);
    engine.input(0);
    for (let i = 0; i < 32; i++) {
      engine.step(game.tick);
      if (!target.alive) {
        for (let y = target.y; y < target.y + 8; y++) {
          assert(
            !engine.pixels.subarray(y * 160 + target.x, y * 160 + target.x + 8).includes(3),
            'A hit target must disappear in the collision frame.',
          );
        }
      }
    }
  };
  fire();
  assert.equal(game.state().score, 1);
  engine.input(1 << 2);
  for (let i = 0; i < 24; i++) engine.step(game.tick);
  assert.equal(game.state().x, 28);
  for (let y = 120; y < 128; y++) {
    assert(
      !engine.pixels.subarray(y * 160 + 76, y * 160 + 84).includes(4),
      'The moving ship must not leave its previous sprite behind.',
    );
  }
  fire();
  assert.equal(game.state().score, 2);
  engine.input(1 << 3);
  for (let i = 0; i < 48; i++) engine.step(game.tick);
  assert.equal(game.state().x, 124);
  fire();
  assert.equal(game.state().score, 3);
  assert(game.state().targets.every((target) => !target.alive));
  assert.equal(game.state().shots.length, 0);
  assert.equal(
    engine.api.scr[16]
      .map((cell) => cell.chr)
      .join('')
      .trim(),
    'CLEAR! B RESET',
  );
  assert(engine.pixels.every((col) => col <= 7));
  engine.input(1 << 5);
  engine.step(game.tick);
  assert.equal(game.state().score, 0);
  assert.equal(game.state().x, 76);
  assert(game.state().targets.every((target) => target.alive));
  assert.equal(
    engine.api.scr[16]
      .map((cell) => cell.chr)
      .join('')
      .trim(),
    'A FIRE  B RESET',
  );
  const payload = await encode(source);
  assert(payload.bytes <= 3072);
  assert(gameURL('https://example.com/', payload.hash).length <= 4096);
});

test('the shooter retains its sixteen-shot limit and reuses space after shots leave', async () => {
  const source = await readFile(new URL('../examples/shooter.js', import.meta.url), 'utf8');
  const engine = createEngine(glyphs, compileScore);
  const game = new Function(
    ...Object.keys(engine.api),
    source + '\nshots = Array.from({length:16},()=>({x:0,y:112})); return {tick,shots:()=>shots};',
  )(...Object.values(engine.api));

  engine.input(1 << 4);
  engine.step(game.tick);
  assert.equal(game.shots().length, 16);
  assert.equal(engine.sounds().length, 0);
  engine.input(0);
  for (let i = 0; i < 32; i++) engine.step(game.tick);
  assert.equal(game.shots().length, 0);

  engine.input(1 << 4);
  engine.step(game.tick);
  assert.equal(game.shots().length, 1);
  assert.equal(engine.sounds().length, 1);
  engine.step(game.tick);
  assert.equal(game.shots().length, 1);
  assert.equal(engine.sounds().length, 0, 'Holding fire must not create another shot.');
});
