// @title Glyph Quest
// Collect every gem and the ring, then reach the castle in three guarded dungeons.
// ⬆⬇⬅➡ move; Ⓐ stuns nearby ghosts. Ⓑ retries this stage.

const levels = [
  {
    name: 'COURTYARD',
    wall: 1,
    map: [
      '####################',
      '#    #    💎        #',
      '#    #  ####  #### #',
      '# 💎  #     #     # #',
      '#    #     #     # #',
      '#    ### # # 💎   # #',
      '#        # #     # #',
      '###  ##### ####  # #',
      '#    #     #     # #',
      '# 💎  # ### # ##  # #',
      '#    #     #     # #',
      '#    #  💍  #  💎    #',
      '# 💎     #         🏰#',
      '####################',
    ],
    patrols: [
      [
        [1, 3],
        [4, 3],
        [4, 6],
        [1, 6],
      ],
      [
        [12, 1],
        [18, 1],
      ],
    ],
  },
  {
    name: 'GALLERIES',
    wall: 4,
    map: [
      '####################',
      '#     💎            #',
      '# ##### #### ##### #',
      '#     #      #   💎 #',
      '#     #      #     #',
      '##### # #### # ### #',
      '#💎    # # 💎  #     #',
      '# ##### # ####### ##',
      '#       #  💎       #',
      '# ######## ####### #',
      '#        #         #',
      '#  💎     #💍        #',
      '#                 🏰#',
      '####################',
    ],
    patrols: [
      [
        [8, 3],
        [12, 3],
      ],
      [
        [1, 8],
        [7, 8],
      ],
      [
        [10, 12],
        [17, 12],
      ],
    ],
  },
  {
    name: 'INNER KEEP',
    wall: 5,
    map: [
      '####################',
      '#                💎 #',
      '# #### ###### #### #',
      '# #  💎    💎      # #',
      '# #              # #',
      '# #  ### ## ###  # #',
      '#💎     #    #     💎#',
      '###### # ## # ######',
      '#      #  💎 #      #',
      '# #  ### ## ###  # #',
      '# #     💎        # #',
      '# #    #    #    # #',
      '#         💍       🏰#',
      '####################',
    ],
    patrols: [
      [
        [5, 3],
        [14, 3],
      ],
      [
        [8, 6],
        [11, 6],
      ],
      [
        [13, 8],
        [18, 8],
      ],
      [
        [3, 12],
        [13, 12],
      ],
    ],
  },
];

let stage = 0;
let map;
let enemies;
let x;
let y;
let frame;
let gems;
let total;
let ring;
let cooldown;
let state;

pcg['#'].pat = pcg['▓'].pat;

function drawStatus() {
  const finalStage = stage === levels.length - 1;
  let title = 'GLYPH QUEST';
  let controls = 'Ⓐ STUN   Ⓑ RETRY';
  if (state === 'CAUGHT') {
    title = 'CAUGHT!';
    controls = 'Ⓑ RETRY';
  } else if (state === 'CLEAR') {
    title = finalStage ? 'ALL CLEAR!' : 'STAGE CLEAR!';
    controls = finalStage ? 'Ⓐ RESTART Ⓑ RETRY' : 'Ⓐ NEXT   Ⓑ RETRY';
  }
  const recharge = state === 'PLAY' ? (cooldown ? ' / WAIT' : ' / READY') : '';

  put(1, 0, title.padEnd(18), state === 'CAUGHT' ? 3 : 6);
  put(16, 0, `${stage + 1}/${levels.length}`, 7);
  put(1, 1, `💎${gems}/${total} + 💍 → 🏰`.padEnd(18));
  put(8, 1, '💍', ring ? 6 : 2);
  put(1, 16, ' '.repeat(18));
  put(Math.floor((20 - controls.length) / 2), 16, controls);
  put(1, 17, (levels[stage].name + recharge).padEnd(18), 2);
}

function startLevel() {
  // All map symbols are single code points, so spread keeps the emoji intact.
  map = levels[stage].map.map((row) => [...row]);
  enemies = levels[stage].patrols.map((route) => ({
    route,
    next: 1,
    x: route[0][0],
    y: route[0][1],
    stun: 0,
  }));
  x = 1;
  y = 1;
  frame = 0;
  gems = 0;
  cooldown = 0;
  total = map.flat().filter((chr) => chr === '💎').length;
  ring = false;
  state = 'PLAY';

  pcg['#'].col = [levels[stage].wall, 0];
  cls(0);
  put(0, 2, map.map((row) => row.join('')).join('\n'));
  drawStatus();
  for (let ch = 0; ch < 3; ch++) {
    play(ch, ch === 0 ? 'T240M7' : '');
  }
}

startLevel();

function tick() {
  if (btnp(5)) {
    startLevel();
  } else if (state === 'CLEAR' && btnp(4)) {
    stage = (stage + 1) % levels.length;
    startLevel();
  } else if (state === 'PLAY') {
    frame++;
    if (cooldown > 0) {
      cooldown--;
      if (cooldown === 0) {
        drawStatus();
      }
    }
    if (btnp(4) && cooldown === 0) {
      cooldown = 90;
      for (const enemy of enemies) {
        if (Math.abs(enemy.x - x) + Math.abs(enemy.y - y) <= 3) {
          enemy.stun = 60;
        }
      }
      drawStatus();
      play(0, 'T240V10O6N1cG');
    }

    const previousX = x;
    const previousY = y;
    if (frame % 7 === 0) {
      const dx = btn(3) - btn(2);
      const dy = dx === 0 ? btn(1) - btn(0) : 0;
      const nx = x + dx;
      const ny = y + dy;
      if (map[ny]?.[nx] && map[ny][nx] !== '#') {
        x = nx;
        y = ny;
      }
    }

    let caught = false;
    for (const enemy of enemies) {
      const oldX = enemy.x;
      const oldY = enemy.y;
      if (enemy.stun > 0) {
        enemy.stun--;
      } else if (frame % (22 - stage * 3) === 0) {
        const [tx, ty] = enemy.route[enemy.next];
        enemy.x += Math.sign(tx - enemy.x);
        enemy.y += Math.sign(ty - enemy.y);
        if (enemy.x === tx && enemy.y === ty) {
          enemy.next = (enemy.next + 1) % enemy.route.length;
        }
      }
      if (
        enemy.stun === 0 &&
        ((enemy.x === x && enemy.y === y) ||
          (oldX === x && oldY === y && enemy.x === previousX && enemy.y === previousY))
      ) {
        caught = true;
      }
    }

    const tile = map[y][x];
    if (caught) {
      state = 'CAUGHT';
      drawStatus();
      play(1, 'V10O3N1gc');
    } else if (tile === '💎' || tile === '💍') {
      if (tile === '💎') {
        gems++;
      } else {
        ring = true;
      }
      map[y][x] = ' ';
      put(x, 2 + y, ' ');
      drawStatus();
      play(1, tile === '💎' ? 'V12O6N1ceG' : 'V12O5N1gBG');
    } else if (tile === '🏰' && ring && gems === total) {
      state = 'CLEAR';
      drawStatus();
      play(0, 'T150V12O5N3cegCN5G');
      play(2, 'V10O3N3cegCN5G');
    }
  }

  // The map starts at cell (0, 2); convert sprite coordinates to pixels.
  if (state !== 'CLEAR') {
    for (const enemy of enemies) {
      spr(enemy.x * 8, 16 + enemy.y * 8, '👻', enemy.stun ? 4 : 3);
    }
  }
  spr(x * 8, 16 + y * 8, '👾', state === 'CAUGHT' ? 2 : 6);
}
