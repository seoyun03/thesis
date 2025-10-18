// ===== 기본 세팅 =====
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d', { alpha: true });
let W = canvas.width = innerWidth;
let H = canvas.height = innerHeight;
addEventListener('resize', () => {
  W = canvas.width = innerWidth;
  H = canvas.height = innerHeight;
});

const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const showCam = document.getElementById('showCam');
const mouseToggle = document.getElementById('mouseToggle');
const statusEl = document.getElementById('status');
const hintEl = document.getElementById('hint');

// ===== 히트맵 버퍼 =====
const points = []; // {x,y,t,weight}
const MAX_POINTS = 150;   // 버퍼 길이
const DECAY = 0.985;      // 가중치 감쇠

function pushPoint(x, y, weight = 1) {
  if (x < 0 || y < 0 || x > W || y > H) return;
  points.push({ x, y, t: performance.now(), weight });
  if (points.length > MAX_POINTS) points.shift();
}

// ===== 렌더 루프(점 잔상 + 그라디언트) =====
let rafId = null;
function render() {
  // 살짝 어둡게 덮어 잔상 자연스런 소멸
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(0, 0, W, H);

  const now = performance.now();
  // 오래된 점 제거 & 그리기
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const age = (now - p.t) / 1000;       // seconds
    const life = Math.max(0, 1 - age * 0.8);
    if (life <= 0) continue;

    const size = 18 + p.weight * 60 * life;
    const hue = 20 + (1 - life) * 220;    // 주황→청보라
    const alpha = 0.20 * p.weight * (0.6 + 0.4 * life);

    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
    g.addColorStop(0.00, `hsla(${hue},90%,55%,${alpha})`);
    g.addColorStop(0.35, `hsla(${hue},90%,45%,${alpha * 0.5})`);
    g.addColorStop(1.00, `hsla(${hue},90%,35%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  rafId = requestAnimationFrame(render);
}

// ===== WebGazer 제어 =====
let usingWebgazer = false;
let gazeActive = false;

function setStatus(s, color='#2a3cff') {
  statusEl.textContent = s;
  statusEl.style.color = color;
}

async function startGaze() {
  setStatus('requesting camera...');
  // 권한 팝업을 먼저 띄움
  try { await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch(e) {}

  setStatus('starting...');
  try {
    webgazer.setRegression('ridge')
      .setGazeListener((data) => {
        if (!data) return;
        // 시선 포인트 추가(가중치 높게)
        pushPoint(data.x, data.y, 1.2);
      })
      .showPredictionPoints(false) // 기본 초록점 숨김
      .begin();

    usingWebgazer = true;
    gazeActive = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus('gaze running');
    hintEl.textContent = '시선을 화면 곳곳에 잠깐씩 머물러 보세요. (Calibrate로 정확도 향상)';
  } catch (e) {
    console.error('webgazer error', e);
    usingWebgazer = false;
    gazeActive = false;
    setStatus('gaze failed', '#c62828');
    hintEl.textContent = '카메라 사용 불가 — 필요 시 Enable mouse fallback을 켜서 테스트하세요.';
  }
}

function stopGaze() {
  try {
    webgazer.pause();
    webgazer.clearGazeListener();
  } catch(e) {}
  usingWebgazer = false;
  gazeActive = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setStatus('stopped', '#777');
}

// ===== 마우스 대체 모드 (옵션) =====
function onMouseMove(e) { pushPoint(e.clientX, e.clientY, 0.6); }
mouseToggle.addEventListener('change', (e) => {
  if (e.target.checked) {
    addEventListener('mousemove', onMouseMove);
    hintEl.textContent = '마우스 기반 대체 모드 ON (시선 예측이 없을 때만 켜는 것을 권장)';
  } else {
    removeEventListener('mousemove', onMouseMove);
    hintEl.textContent = '마우스 기반 대체 모드 OFF';
  }
});

// ===== 카메라 피드 표시 토글 =====
showCam.addEventListener('change', () => {
  const feed = document.getElementById('webgazerVideoFeed');
  if (!feed) return;
  feed.style.display = showCam.checked ? 'block' : 'none';
});

// ===== 캘리브레이션 =====
function calibrate() {
  const pts = [
    [0.1,0.1],[0.5,0.1],[0.9,0.1],
    [0.1,0.5],[0.5,0.5],[0.9,0.5],
    [0.1,0.9],[0.5,0.9],[0.9,0.9],
  ];
  let i = 0;
  const dot = document.createElement('div');
  dot.className = 'cal-dot';
  document.body.appendChild(dot);

  function next() {
    if (i >= pts.length) {
      dot.remove();
      hintEl.textContent = '캘리브레이션 완료!';
      return;
    }
    const [rx, ry] = pts[i];
    dot.style.left = `${rx * innerWidth}px`;
    dot.style.top  = `${ry * innerHeight}px`;
    hintEl.textContent = `Calibrate: 점을 바라보고 클릭 (${i+1}/${pts.length})`;

    let clicked = false;
    const onClick = () => {
      clicked = true;
      removeEventListener('click', onClick);
      i++; setTimeout(next, 200);
    };
    addEventListener('click', onClick);

    setTimeout(() => {
      if (!clicked) { removeEventListener('click', onClick); i++; next(); }
    }, 1200);
  }
  next();
}

// ===== 버튼 이벤트 =====
startBtn.addEventListener('click', startGaze);
stopBtn.addEventListener('click', () => { stopGaze(); });
calibrateBtn.addEventListener('click', calibrate);

// ===== 주기적 감쇠 =====
setInterval(() => {
  for (let i = 0; i < points.length; i++) points[i].weight *= DECAY;
}, 100);

// ===== 시작 =====
render();
setStatus('idle');
