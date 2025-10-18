// ===== 캔버스/렌더 세팅 =====
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d', { alpha: false });
const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));

let cell, cols, rows, heat;
function resize() {
  canvas.width  = innerWidth * DPR;
  canvas.height = innerHeight * DPR;

  // 화면 크기에 비례한 셀 크기 (값이 작을수록 촘촘하지만 비용↑)
  cell = Math.max(8 * DPR, Math.floor(Math.min(canvas.width, canvas.height) / 120));
  cols = Math.ceil(canvas.width / cell);
  rows = Math.ceil(canvas.height / cell);
  heat = new Float32Array(cols * rows); // 0.0 ~ 1.0
}
resize();
addEventListener('resize', resize);

// ===== 마우스(폴백) 좌표 =====
let mx = -1, my = -1, lmx = -1, lmy = -1;
let lastMouseMove = performance.now();

canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  mx = (e.clientX - r.left) * DPR;
  my = (e.clientY - r.top) * DPR;
  lastMouseMove = performance.now();
});
canvas.addEventListener('pointerleave', () => { mx = my = -1; });

// ===== 시선 좌표 (WebGazer) + 스무딩 =====
let gazeX = -1, gazeY = -1, lgx = -1, lgy = -1, lastGazeTime = 0;
let hasGaze = false;
const ALPHA = 0.35; // 지터 완화 (지수가중 스무딩)
const smooth = (prev, next) => (prev < 0 ? next : prev * (1 - ALPHA) + next * ALPHA);

// WebGazer 초기화 (HTTPS 필요)
(async () => {
  try {
    await webgazer.setRegression('ridge').begin();
    // 오버레이 비활성 (버전차 보정: CSS로도 숨김)
    if (webgazer.showVideoPreview) webgazer.showVideoPreview(false);
    if (webgazer.showPredictionPoints) webgazer.showPredictionPoints(false);

    webgazer.setGazeListener((data, ts) => {
      if (!data) return;
      const x = data.x * DPR; // px 좌표
      const y = data.y * DPR;
      gazeX = smooth(gazeX, x);
      gazeY = smooth(gazeY, y);
      lastGazeTime = ts || performance.now();
      hasGaze = true;
    });
  } catch (err) {
    console.warn('WebGazer init failed; using mouse fallback.', err);
    hasGaze = false;
  }
})();

// ===== 열 도장 (가우시안 붓) =====
function stampHeat(x, y, amount = 0.06, radius = 4) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  for (let j = -radius; j <= radius; j++) {
    for (let i = -radius; i <= radius; i++) {
      const ix = cx + i, iy = cy + j;
      if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) continue;
      const d2 = i * i + j * j;
      const w = Math.exp(-d2 / (radius)); // 부드러운 확산
      const idx = iy * cols + ix;
      heat[idx] = Math.min(1, heat[idx] + amount * w);
    }
  }
}

// ===== 색상 매핑: 파(차가움) → 초 → 노 → 빨(과열) =====
function heatToRGB(h) {
  if (h >= 0.75) return [255, 0,   0  ]; // red
  if (h >= 0.50) return [0,   255, 0  ]; // green
  if (h >= 0.25) return [255, 255, 0  ]; // yellow
  return                 [0,   120, 255]; // blue
}

// ===== 메인 루프 =====
const off = document.createElement('canvas');
const octx = off.getContext('2d');

(function draw() {
  requestAnimationFrame(draw);
  const now = performance.now();

  // 우선 시선 좌표 사용, 없으면 마우스 폴백
  let x = -1, y = -1, still = false, idleMs = 0;

  if (hasGaze && (now - lastGazeTime) < 500) {
    x = gazeX; y = gazeY;
    const moveDist = Math.hypot(gazeX - lgx, gazeY - lgy);
    still = moveDist < 2 * DPR;
    idleMs = now - lastGazeTime; // 직전 업데이트 시점 기준
    lgx = gazeX; lgy = gazeY;
  } else if (mx >= 0 && my >= 0) {
    x = mx; y = my;
    const moveDist = Math.hypot(mx - lmx, my - lmy);
    still = moveDist < 2 * DPR;
    idleMs = now - lastMouseMove;
    lmx = mx; lmy = my;
  }

  // 머무는 시간에 따라 반경/강도 증가 (오래 볼수록 넓고 진하게)
  if (x >= 0 && y >= 0) {
    const dynamicRadius = Math.min(18, 2 + idleMs / 140);
    const dynamicAmount = Math.min(0.09, 0.02 + idleMs / 2800);
    stampHeat(x, y, still ? dynamicAmount : 0.01, still ? dynamicRadius : 2);
  }

  // 냉각(디톡스): 시간이 지나며 색이 식으면서 파→초→노→빨 역순으로 사라짐
  for (let k = 0; k < heat.length; k++) {
    heat[k] = Math.max(0, heat[k] - 0.005); // 값을 키우면 빨리 식음
  }

  // 저해상도 버퍼에 픽셀 그리기
  off.width = cols;
  off.height = rows;
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

  // 고해상도 캔버스에 확대 렌더(부드러운 퍼짐)
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
})();
