let x = 76, y = 68, score = 0
let gx = 36, gy = 44
pcg['👾'].col = [6, 1]
pcg['💎'].col = [4, 1]
play(0, 'T150O4N3cegb))')

function tick() {
  const speed = btn(4) ? 2 : 1
  x = Math.max(8, Math.min(144, x + (btn(3) - btn(2)) * speed))
  y = Math.max(24, Math.min(120, y + (btn(1) - btn(0)) * speed))
  if (Math.abs(x - gx) < 8 && Math.abs(y - gy) < 8) {
    score++
    gx = 8 + Math.floor(Math.random() * 17) * 8
    gy = 24 + Math.floor(Math.random() * 12) * 8
    play(1, 'O6N1GC')
  }
  if (btnp(5)) {
    gx = 8 + Math.floor(Math.random() * 17) * 8
    gy = 24 + Math.floor(Math.random() * 12) * 8
    play(2, 'O3N1c')
  }
  cls(1)
  col(7, 1)
  put('GEMS ' + score, 8, 8)
  put('💎', gx, gy)
  put('👾', x, y)
}
