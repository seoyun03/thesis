// ===== 기본 설정 =====
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d', { alpha: false });
const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));

let cell, cols, rows, heat;
resize();
window.addEventListener('resize', resize);

let mx = -99999, my = -99999, lmx = -99999, lmy = -99999;
let lastMove = performance.now();

let dwellStart = performance.now();
let anchorX = -99999, anchorY = -99999;

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  mx = (e.clientX - r.left) * DPR;
  my = (e.clientY - r.top) * DPR;
  lastMove = performance.now();
});
canvas.addEventListener('pointerdown', () => (lastMove = performance.now()));
canvas.addEventListener('pointerleave', () => { mx = my = -99999; });

function resize() {
  canvas.width = innerWidth * DPR;
  canvas.height = innerHeight * DPR;
  cell = Math.max(8 * DPR, Math.floor(Math.min(canvas.width, canvas.height) / 120));
  cols = Math.ceil(canvas.width / cell);
  rows = Math.ceil(canvas.height / cell);
  heat = new Float32Array(cols * rows);
}

function stampHeat(x, y, amount = 0.06, radius = 4) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  for (let j = -radius; j <= radius; j++) {
    for (let i = -radius; i <= radius; i++) {
      const ix = cx + i, iy = cy + j;
      if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) continue;
      const d2 = i * i + j * j;
      const w = Math.exp(-d2 / (radius));
      const idx = iy * cols + ix;
      heat[idx] = Math.min(1, heat[idx] + amount * w);
    }
  }
}

// ===== 색상 그라데이션 =====
const stops = [
  { t: 0.00, c: [  0, 120, 255] },
  { t: 0.25, c: [  0, 255,   0] },
  { t: 0.50, c: [255, 255,   0] },
  { t: 1.00, c: [255,   0,   0] },
];
const lerp = (a, b, t) => a + (b - a) * t;
function mixRGB(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}
function heatToRGB(h) {
  if (h <= stops[0].t) return stops[0].c;
  if (h >= stops[stops.length - 1].t) return stops[stops.length - 1].c;
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1], next = stops[i];
    if (h <= next.t) {
      const tt = (h - prev.t) / (next.t - prev.t);
      return mixRGB(prev.c, next.c, tt);
    }
  }
  return stops[stops.length - 1].c;
}

const off = document.createElement('canvas');
const octx = off.getContext('2d');

(function draw() {
  requestAnimationFrame(draw);

  const now = performance.now();
  const dx = mx - lmx, dy = my - lmy;
  const speed = Math.hypot(dx, dy);
  const still = speed < 2 * DPR && (now - lastMove) > 16;

  if (!still) {
    anchorX = mx;
    anchorY = my;
    dwellStart = now;
  }
  const dwellSec = Math.max(0, (now - dwellStart) / 1000);

  // ===== 원 크기 강화 버전 =====
  const rMin = 3;
  const rMaxBase = 60;        // 최대 반경 크게 (기존 28 → 60)
  const timeToMax = 3.5;      // 약 3.5초 머무르면 최대
  const gamma = 1.2;
  let t = Math.min(1, dwellSec / timeToMax);
  t = Math.pow(t, gamma);
  let radius = Math.floor(rMin + (rMaxBase - rMin) * t);

  // 누적 열에 따라 반경 보너스 (최대 1.4배)
  if (anchorX > 0 && anchorY > 0) {
    const cx = Math.floor(anchorX / cell), cy = Math.floor(anchorY / cell);
    if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
      const localHeat = heat[cy * cols + cx] || 0;
      const bonus = 1 + 0.4 * localHeat;
      radius = Math.floor(Math.min(rMaxBase * 1.4, radius * bonus));
    }
  }

  const base = still ? 0.06 : 0.02;
  const amt  = base * (6 / Math.max(3, radius));

  if (mx > 0 && my > 0) {
    const px = still ? anchorX : mx;
    const py = still ? anchorY : my;
    stampHeat(px, py, amt, radius);
  }

  lmx = mx; lmy = my;

  // ===== 잔상 오래 유지 =====
  const COOL = 0.0015;
  for (let k = 0; k < heat.length; k++) {
    heat[k] = Math.max(0, heat[k] - COOL);
  }

  // ===== 렌더링 =====
  off.width = cols; off.height = rows;
  const img = octx.createImageData(cols, rows);
  let p = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const h = heat[j * cols + i];
      const [r, g, b] = heatToRGB(h);
      img.data[p++] = r;
      img.data[p++] = g;
      img.data[p++] = b;
      img.data[p++] = 255;
    }
  }
  octx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.filter = 'blur(6px)';
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  ctx.filter = 'none';
})();
