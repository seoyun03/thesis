/*********************************************************
 * Gaze Grid – Stable (WebGazer)
 * - 그리드 자동 레이아웃
 * - 중앙값 + 적응형 EMA 스무딩
 * - 같은 셀에 머물면 회색→초록→노랑→빨강
 * - 3x3 캘리브레이션
 **********************************************************/

/* ===== DOM ===== */
const grid       = document.getElementById('grid');
const startBtn   = document.getElementById('startBtn');
const calBtn     = document.getElementById('calBtn');
const statusEl   = document.getElementById('status');
const signalEl   = document.getElementById('signal');
const coordEl    = document.getElementById('coord');
const dot        = document.getElementById('dot');

const calOverlay = document.getElementById('calOverlay');
const calPoints  = document.getElementById('calPoints');
const calDoneBtn = document.getElementById('calDoneBtn');

/* ===== Helpers ===== */
const cssPx = (v) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v).trim());

function setStatus(text, color = '#cfe3ff') {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = color;
}

/* ===== Grid Layout ===== */
let GRID = null;

function layoutGrid() {
  const bs  = cssPx('--block-size');
  const gap = cssPx('--gap');
  const rect = grid.getBoundingClientRect();

  const cols = Math.max(1, Math.floor((rect.width  + gap) / (bs + gap)));
  const rows = Math.max(1, Math.floor((rect.height + gap) / (bs + gap)));
  const need = cols * rows;

  grid.style.gridTemplateColumns = `repeat(${cols}, var(--block-size))`;

  const cur = grid.children.length;
  if (cur < need) {
    const frag = document.createDocumentFragment();
    for (let i = cur; i < need; i++) {
      const d = document.createElement('div');
      d.className = 'block';
      d.dataset.level = '0'; // 0=회색, 1=초록, 2=노랑, 3=빨강
      frag.appendChild(d);
    }
    grid.appendChild(frag);
  } else {
    for (let i = cur - 1; i >= need; i--) grid.removeChild(grid.children[i]);
  }

  GRID = { cols, rows, rect };
}
layoutGrid();
addEventListener('resize', () => {
  clearTimeout(layoutGrid._t);
  layoutGrid._t = setTimeout(layoutGrid, 80);
});

/* ===== 색상 단계 로직 ===== */
// 초기색은 CSS의 --color(회색). 이후 단계는 초록→노랑→빨강.
const SEQ = ['#00b200', '#ffd400', '#ff3b3b'];
const DWELL_MS = 140; // 같은 칸에 이 시간(ms) 머물면 한 단계 상승

function bumpCell(block) {
  let lvl = +(block.dataset.level || 0);
  if (lvl >= 3) return; // 이미 빨강이면 종료
  lvl += 1;
  block.dataset.level = String(lvl);
  block.style.backgroundColor = SEQ[lvl - 1]; // 1→초록, 2→노랑, 3→빨강
}

/* ===== 좌표→셀 매핑(경계 흔들림↓) ===== */
function pointToCell(px, py) {
  if (!GRID) return null;
  const { cols, rows, rect } = GRID;
  const bs  = cssPx('--block-size');
  const gap = cssPx('--gap');

  const style = getComputedStyle(grid);
  const padL = parseFloat(style.paddingLeft);
  const padT = parseFloat(style.paddingTop);

  const gx = px - rect.left - padL;
  const gy = py - rect.top  - padT;
  if (gx < 0 || gy < 0) return null;

  const pitch = bs + gap;
  const cx = Math.floor((gx + gap * 0.5) / pitch);
  const cy = Math.floor((gy + gap * 0.5) / pitch);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null;

  const idx = cy * cols + cx;
  return grid.children[idx] || null;
}

/* ===== 시선 스무딩(중앙값 + 적응형 EMA) ===== */
const BUF_N = 5;
const rawBuf = [];
let emaX = null, emaY = null;
let lastTs = performance.now();
const EMA_MIN = 0.12, EMA_MAX = 0.35;

const median = (arr) => {
  const a = arr.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

function smooth(x, y, dt) {
  rawBuf.push({ x, y });
  if (rawBuf.length > BUF_N) rawBuf.shift();

  const mx = median(rawBuf.map(v => v.x));
  const my = median(rawBuf.map(v => v.y));

  if (emaX == null) { emaX = mx; emaY = my; return { x: mx, y: my }; }

  const v = Math.min(1, Math.hypot(mx - emaX, my - emaY) / Math.max(1, dt) / 60);
  const a = EMA_MIN + (EMA_MAX - EMA_MIN) * v;

  emaX += a * (mx - emaX);
  emaY += a * (my - emaY);
  return { x: emaX, y: emaY };
}

/* ===== WebGazer ===== */
let running = false;
let lastCell = null;
let dwellStart = 0;
const CONF_TH = 0.25;

startBtn.addEventListener('click', async () => {
  try {
    setStatus('Requesting camera access…', '#ffd400');
    dot.style.display = 'block';

    // 권한 프리플라이트(일부 브라우저에서 권한 팝업 확실히 띄움)
    await navigator.mediaDevices.getUserMedia({ video: true });

    await webgazer
      .setRegression('ridge')
      .showVideoPreview(true)
      .showPredictionPoints(false)
      .begin();

    setTimeout(() => webgazer.showVideoPreview(false), 1200);

    running = true;
    setStatus('Started — calibration recommended', '#7CFC00');
    calBtn.disabled = false;

    requestAnimationFrame(gazeLoop);
  } catch (e) {
    console.error(e);
    setStatus('Failed: Check HTTPS, permissions, or camera', '#ff3b3b');
  }
});

calBtn.addEventListener('click', () => {
  if (!running) { setStatus('Please click [Start] first', '#ffd400'); return; }
  buildCalibration();
  calOverlay.style.display = 'grid'; // 명시적으로 보이기
  setStatus('Calibrating…', '#cfe3ff');
});

function buildCalibration() {
  calPoints.innerHTML = '';
  const W = calPoints.clientWidth;
  const H = calPoints.clientHeight;
  const xs = [0.1, 0.5, 0.9], ys = [0.1, 0.5, 0.9];

  ys.forEach(y => xs.forEach(x => {
    const d = document.createElement('div');
    d.className = 'calDot';
    d.style.left = `${x * W}px`;
    d.style.top  = `${y * H}px`;
    d.title = '여기를 여러 번 클릭';
    d.addEventListener('click', () => {
      for (let k = 0; k < 12; k++) webgazer.recordScreenPosition(x * W, y * H, 'click');
      d.classList.add('done');
    });
    calPoints.appendChild(d);
  }));
}

calDoneBtn.addEventListener('click', () => {
  calOverlay.style.display = 'none'; // 명시적으로 숨기기
  setStatus('Calibration complete — tracking in progress', '#7CFC00');
});

/* ===== 메인 루프 ===== */
async function gazeLoop(ts) {
  if (!running) return;

  let pred = null;
  try {
    pred = await webgazer.getCurrentPrediction();
  } catch (e) { /* 다음 프레임에서 재시도 */ }

  // 신호 표시등
  if (pred && (typeof pred.confidence !== 'number' || pred.confidence >= CONF_TH)) {
    signalEl.style.background = '#4bd37b';
  } else {
    signalEl.style.background = '#d66';
  }

  if (pred) {
    coordEl.textContent = `(${pred.x | 0}, ${pred.y | 0})`;

    const dt = Math.max(16, ts - lastTs); lastTs = ts;
    const sm = smooth(pred.x, pred.y, dt);

    // 스무딩된 빨간 점 이동
    dot.style.left = sm.x + 'px';
    dot.style.top  = sm.y + 'px';
    dot.style.transform = 'translate(-50%,-50%)';

    // 같은 셀에 DWELL_MS 이상 머무르면 단계 상승
    const cell = pointToCell(sm.x, sm.y);
    if (cell !== lastCell) {
      lastCell = cell;
      dwellStart = ts;
    } else if (cell && (ts - dwellStart >= DWELL_MS)) {
      dwellStart = ts;
      bumpCell(cell);
    }
  }

  requestAnimationFrame(gazeLoop);
}

/* ===== 초기 상태 ===== */
setStatus('Waiting');
signalEl.style.background = '#777';
coordEl.textContent = '';
dot.style.display = 'block';
