// === 엘리먼트 ===
const dot = document.getElementById('dot');
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const showCam  = document.getElementById('showCam');
const statusEl = document.getElementById('status');
const hintEl   = document.getElementById('hint');

// === 상태 표시 ===
function setStatus(text, color = '#2a3cff') {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

// === 마우스 관련 코드 없음(완전 제거) ===

// === 시선 좌표 (스무딩) ===
let haveGaze = false;
let gx = innerWidth / 2;
let gy = innerHeight / 2;
let sx = gx, sy = gy;            // 화면에 그릴 스무딩 좌표
const SMOOTH = 0.25;             // 0~1 (높을수록 빨리 따라감)
let lastTs = 0;

// === 점 위치 갱신 (DOM transform) ===
function placeDot(x, y) {
  dot.style.transform = `translate(${x - 8}px, ${y - 8}px)`; // 점 중심 정렬(반지름=8)
}

// === 애니메이션 루프 ===
function loop(t) {
  if (haveGaze) {
    // 지터 줄이기 위한 1차 지수평활
    sx += (gx - sx) * SMOOTH;
    sy += (gy - sy) * SMOOTH;

    // 화면 경계 내로 클램프 (viewport 기준)
    const x = Math.max(0, Math.min(innerWidth,  sx));
    const y = Math.max(0, Math.min(innerHeight, sy));
    placeDot(x, y);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// === WebGazer 제어 ===
let running = false;

async function startGaze() {
  setStatus('requesting camera...');
  // 권한 팝업 먼저 띄우기
  try { await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch (e) {}

  setStatus('starting...');
  try {
    webgazer
      .setRegression('ridge')
      .setGazeListener((data, ts) => {
        if (!data) return;                 // 예측 없으면 점 고정 (마우스 대체 없음)
        haveGaze = true;
        gx = data.x;                       // ★ WebGazer는 viewport 기준 좌표 제공
        gy = data.y;                       //    DOM fixed 요소에 그대로 사용 → 좌우/전체 영역 정확
        lastTs = ts;
      })
      .showPredictionPoints(false)         // 기본 초록 점 숨김(우리가 직접 그린다)
      .begin();

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    setStatus('gaze running');
    hintEl.textContent = '초록 점이 눈을 따라 움직여야 합니다. 정확도 향상은 Calibrate를 사용하세요.';
  } catch (e) {
    console.error(e);
    running = false;
    setStatus('gaze failed', '#c62828');
    hintEl.textContent = '카메라 접근 실패. 브라우저 권한을 확인하세요.';
  }
}

function stopGaze() {
  try {
    webgazer.pause();
    webgazer.clearGazeListener();
  } catch (e) {}
  running = false;
  startBtn.disabled = false;
  stopBtn.disabled  = true;
  setStatus('stopped', '#777');
}

// === 카메라 피드 표시 토글 (선택) ===
showCam.addEventListener('change', () => {
  const feed = document.getElementById('webgazerVideoFeed');
  if (!feed) return;
  feed.style.display = showCam.checked ? 'block' : 'none';
});

// === 캘리브레이션 ===
function calibrate() {
  const pts = [
    [0.1,0.1],[0.5,0.1],[0.9,0.1],
    [0.1,0.5],[0.5,0.5],[0.9,0.5],
    [0.1,0.9],[0.5,0.9],[0.9,0.9],
  ];
  let i = 0;
  const dotCal = document.createElement('div');
  dotCal.className = 'cal-dot';
  document.body.appendChild(dotCal);

  function next() {
    if (i >= pts.length) {
      dotCal.remove();
      hintEl.textContent = '캘리브레이션 완료!';
      return;
    }
    const [rx, ry] = pts[i];
    dotCal.style.left = `${rx * innerWidth}px`;
    dotCal.style.top  = `${ry * innerHeight}px`;
    hintEl.textContent = `Calibrate: 점을 바라보고 클릭 (${i+1}/${pts.length})`;

    let clicked = false;
    const onClick = () => { clicked = true; removeEventListener('click', onClick); i++; setTimeout(next, 200); };
    addEventListener('click', onClick);

    setTimeout(() => { if (!clicked) { removeEventListener('click', onClick); i++; next(); } }, 1200);
  }
  next();
}

// === 이벤트 바인딩 ===
startBtn.addEventListener('click', startGaze);
stopBtn.addEventListener('click', stopGaze);
calibrateBtn.addEventListener('click', calibrate);

// === 안전장치: 창 크기 바뀔 때도 viewport 좌표 그대로 사용 ===
addEventListener('resize', () => {
  // DOM 고정 포지셔닝이므로 별도 보정 불필요 — 점은 계속 viewport 좌표와 동기화됨
});
