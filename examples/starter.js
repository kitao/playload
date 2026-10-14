// @title My Game
let x = 76;
let y = 68;
let gx = 14;
let gy = 8;
let gems = 0;

function draw() {
  put(1, 1, 'GEMS ' + gems);
  put(gx, gy, '💎', 4);
}

draw();

function tick() {
  x = Math.max(0, Math.min(152, x + btn(3) - btn(2)));
  y = Math.max(0, Math.min(136, y + btn(1) - btn(0)));

  if (Math.abs(x - gx * 8) < 6 && Math.abs(y - gy * 8) < 6) {
    put(gx, gy, ' ');
    gems += 1;
    gx = Math.floor(Math.random() * 20);
    gy = 2 + Math.floor(Math.random() * 16);
    draw();
    play(0, 'T240V12O6N1cG');
  }

  spr(x, y, '👾', 6);
}
