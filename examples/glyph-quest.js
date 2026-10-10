// @title Glyph Quest
// A tiny dungeon made entirely from built-in Unicode artwork.
// Arrows move; collect six gems and the ring, then reach the castle. Z restarts.

// State persists between ticks; x and y are positions in the map's 8×8 cells.
let x = 1;
let y = 1;
let frame = 0;
let gems = 0;
let ring = false;
let won = false;

pcg['#'].pat = pcg['▓'].pat;
pcg['#'].col = [1, 0];

// Each map symbol is one Unicode code point, so spread keeps its emoji intact.
const map = [
  '##################',
  '#   #    💎       #',
  '#   #  ####  ### #',
  '# 💎 #     #    # #',
  '#   ### # # 💎  # #',
  '#       # #    # #',
  '### ##### #### # #',
  '#   #     #    # #',
  '# 💎 # ### # ## # #',
  '#   #  💍  #  💎   #',
  '# 💎    #        🏰#',
  '##################',
].map((row) => [...row]);
const original = map.map((row) => row.slice());

function drawMap() {
  cls(0);
  put(1, 1, 'GLYPH QUEST', 6, 0);
  put(1, 2, '6 GEMS + 💍 → 🏰', 7, 0);
  put(1, 3, map.map((row) => row.join('')).join('\n'));
  put(1, 16, '💎0/6     A RESET', 7, 0);
}

function reset() {
  x = 1;
  y = 1;
  frame = 0;
  gems = 0;
  ring = false;
  won = false;
  original.forEach((row, i) => {
    map[i] = row.slice();
  });
  drawMap();

  for (let ch = 0; ch < 3; ch++) {
    play(ch, '');
  }
}

drawMap();

function tick() {
  if (btnp(4)) {
    reset();
  }

  if (!won) {
    frame++;
  }

  // Move at most one cell every seven ticks.
  if (!won && frame % 7 === 0) {
    const nx = x + btn(3) - btn(2);
    const ny = y + btn(1) - btn(0);

    const tile = map[ny]?.[nx];
    if (tile && tile !== '#') {
      x = nx;
      y = ny;

      if (tile === '💎') {
        gems++;
        play(1, 'V12O6N1ceG');
      }

      if (tile === '💍') {
        ring = true;
        play(1, 'V12O5N1gBG');
      }

      if (tile === '💎' || tile === '💍') {
        map[y][x] = ' ';
        put(1 + x, 3 + y, ' ');
        put(1, 16, `💎${gems}/6  ${ring ? '💍' : ' '}  A RESET`, 7, 0);
      }

      if (tile === '🏰' && ring && gems === 6) {
        won = true;
        put(1, 1, 'ALL GEMS FOUND!', 6, 0);
        put(1, 2, ' '.repeat(18), 7, 0);
        play(0, 'T150V12O5N3cegCN5G');
        play(2, 'V10O3N3cegCN5G');
      }
    }
  }

  // The map starts at cell (1, 3); convert the player position to pixels.
  spr(8 + x * 8, 24 + y * 8, '👾', 6);
}
