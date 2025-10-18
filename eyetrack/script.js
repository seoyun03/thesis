// ===== DOM =====
const heat = document.getElementById('heat');
const hctx = heat.getContext('2d');
const dot = document.getElementById('dot');

const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const showCam  = document.getElementById('showCam');
const statusEl = document.getElementById('status');
const hintEl   = document.getElementById('hint');

// ===== Viewport & Canvas =====
let W = heat.width  = innerWidth;
let H = heat.height = innerHeight;
addEventListener('resize', () => {
  W = heat.width  = innerWidth;
  H = heat.height = innerHeight;
  // 내부 강도 캔버스도 스케일 재계산
  setupIntensityCanvas();
});

// ===== 상태 표시 =====
function setStatus(text, color = '#2a3cff') {
  statusEl.textContent = text;
  statusEl.style.color = color;
}

// ===== 시선 좌표 (마우스 완전 미사용) =====
let haveGaze = false;
let gx = innerWidth / 2, gy = innerHeight / 2; // raw gaze
let sx = gx, sy = gy; // smoothed gaze
const SMOOTH = 0.25;

// ===== 강도 캔버스 (저해상도 누적 -> 컬러로 업샘플) =====
let iCanvas, iCtx, IW, IH;
function setupIntensityCanvas() {
  // 해상도: 화면의 1/4씩 (성능과 부드러움 균형)
  IW = Math.max(160, Math.floor(innerWidth  / 4));
  IH = Math.max(120, Math.floor(innerHeight / 4));
  iCanvas = document.createElement('canvas');
  iCanvas.width = IW;
  iCanvas.height = IH;
  iCtx = iCanvas.getContext('2d');
  iCtx.clearRect(0, 0, IW, IH);
}
setupIntensityCanvas();

// ===== 컬러 룩업 테이블 (0~255 -> heatmap 색: blue→green→yellow→red) =====
const LUT = new Uint8ClampedArray(256 * 4);
(function buildLUT() {
  // 구간별 보간: 0-85(파→초록), 85-170(초록→노랑), 170-255(노랑→빨강)
  for (let i = 0; i < 256; i++) {
    let r=0, g=0, b=0; 
    if (i <= 85) {
      const t = i / 85;        // 0→1
      r = 0;
      g = Math.round(255 * t);
      b = Math.round(255 * (1 - t));
    } else if (i <= 170) {
      const t = (i - 85) / 85; // 0→1
      r = Math.round(255 * t);
      g = 255;
      b = 0;
    } else {
      const t = (i - 170) / 85;// 0→1
      r = 255;
      g = Math.round(255 * (1 - t));
      b = 0;
    }
    const idx = i * 4;
    LUT[idx]   = r;
    LUT[idx+1] = g;
    LUT[idx+2] = b;
    LUT[idx+3] = i; // 알파도 강도와 동일하게 (부드러운 합성)
  }
})();

// ===== 강도 누적 & 감쇠 파라미터 =====
const G_RADIUS = 18;      // 가우시안 반경(px, intensity 캔버스 기준)
const HIT_ALPHA = 0.14;   // 한 번 찍을 때 강도 (여러 프레임 누적되며 빨→강해짐)
const DECAY = 0.965;      // 프레임마다 서서히 사라짐 (1에 가까울수록 오래 유지)

// 가우시안 브러시(프리컴퓨트)
let brush;
function buildBrush(radius) {
  const s = radius * 2 + 1;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  // 중심에서 밖으로 갈수록 투명해지는 원형 그라디언트
  const grd = ctx.createRadialGradient(radius+0.5, radius+0.5, 0, radius+0.5, radius+0.5, radius);
  grd.addColorStop(0,   `rgba(255,255,255,${HIT_ALPHA})`);
  grd.addColorStop(1.0, `rgba(255,255,255,0)`);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(radius+0.5, radius+0.5, radius, 0, Math.PI*2);
  ctx.fill();
  return c;
}
brush = buildBrush(G_RADIUS);

// ===== Gaze 처리 =====
function placeDot(x, y) {
  dot.style.transform = `translate(${x - 6}px, ${y - 6}px)`;
}

// 강도 캔버스에 현재 시선 찍기
function stampGaze(x, y) {
  const ix = (x / W) * IW;
  const iy = (y / H) * IH;
  iCtx.globalCompositeOperation = 'source-over';
  iCtx.drawImage(brush, Math.round(ix - G_RADIUS), Math.round(iy - G_RADIUS));
}

// 강도 감쇠(서서히 사라짐)
function decayIntensity() {
  iCtx.globalCompositeOperation = 'source-over';
  iCtx.fillStyle = `rgba(0,0,0,${1 - DECAY})`;
  iCtx.fillRect(0, 0, IW, IH);
}

// 강도를 컬러로 변환해서 heat 캔버스에 그리기
function colorizeToMain() {
  const id = iCtx.getImageData(0, 0, IW, IH);
  const src = id.data;
  const out = new ImageData(IW, IH);
  const dst = out.data;

  // src는 흰색+알파로 찍혀 있으므로 "강도"는 알파 채널 사용
  for (let i = 0, p = 0; i < src.length; i += 4, p += 4) {
    const a = src[i+3]; // 0~255
    if (a === 0) { // 완전 투명 → 검정
      dst[p] = dst[p+1] = dst[p+2] = 0;
      dst[p+3] = 0;
    } else {
      const lut = a << 2; // a*4
      dst[p]   = LUT[lut];
      dst[p+1] = LUT[lut+1];
      dst[p+2] = LUT[lut+2];
      dst[p+3] = Math.min(255, LUT[lut+3]);
    }
  }

  // 메인 캔버스에 부드럽게 업샘플
  hctx.clearRect(0, 0, W, H);
  hctx.imageSmoothingEnabled = true;
  hctx.putImageData(out, 0, 0);
  // putImageData는 리사이즈가 안되므로, 임시 캔버스로 한번 그리고 drawImage로 스케일
  const temp = document.createElement('canvas');
  temp.width = IW; temp.height = IH;
  temp.getContext('2d').putImageData(out, 0, 0);
  hctx.drawImage(temp, 0, 0, W, H);
}

// ===== 메인 루프 =====
function loop() {
  // gaze smoothing
  if (haveGaze) {
    sx += (gx - sx) * SMOOTH;
    sy += (gy - sy) * SMOOTH;
    const x = Math.max(0, Math.min(W, sx));
    const y = Math.max(0, Math.min(H, sy));
    placeDot(x, y);
    stampGaze(x, y);    // 현재 위치에 강도 누적
  }
  decayIntensity();     // 전체적으로 서서히 사라짐
  colorizeToMain();     // 컬러 매핑 후 메인 캔버스에 반영
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ===== WebGazer 제어 (마우스 대체 없음) =====
let running = false;

async function startGaze() {
  setStatus('requesting camera...');
  try { await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch (e) {}
  setStatus('starting...');
  try {
    webgazer
      .setRegression('ridge')
      .setGazeListener((data) => {
        if (!data) return;      // 예측 없을 땐 아무것도 하지 않음(마우스 대체 X)
        haveGaze = true;
        gx = data.x;            // viewport 좌표 그대로 사용
        gy = data.y;
      })
      .showPredictionPoints(false)
      .begin();

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    setStatus('gaze running');
    hintEl.textContent = '시선을 한 지점에 오래 두면 파→초→노→빨로 부드럽게 변합니다.';
  } catch (e) {
    console.error(e);
    running = false;
    setStatus('gaze failed', '#c62828');
    hintEl.textContent = '카메라 접근 실패. 브라우저 권한/조명을 확인하세요.';
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

// ===== 카메라 피드 토글 =====
showCam.addEventListener('change', () => {
  const feed = document.getElementById('webgazerVideoFeed');
  if (feed) feed.style.display = showCam.checked ? 'block' : 'none';
});

// ===== 캘리브레이션 =====
function calibrate() {
  const pts = [
    [0.1,0.1],[0.5,0.1],[0.9,0.1],
    [0.1,0.5],[0.5,0.5],[0.9,0.5],
    [0.1,0.9],[0.5,0.9],[0.9,0.9],
  ];
  let i = 0;
  const d = document.createElement('div');
  d.className = 'cal-dot';
  document.body.appendChild(d);

  function next() {
    if (i >= pts.length) {
      d.remove();
      hintEl.textContent = '캘리브레이션 완료!';
      return;
    }
    const [rx, ry] = pts[i];
    d.style.left = `${rx * innerWidth}px`;
    d.style.top  = `${ry * innerHeight}px`;
    hintEl.textContent = `Calibrate: 점을 바라보고 클릭 (${i+1}/${pts.length})`;

    let clicked = false;
    const onClick = () => { clicked = true; removeEventListener('click', onClick); i++; setTimeout(next, 200); };
    addEventListener('click', onClick);
    setTimeout(() => { if (!clicked) { removeEventListener('click', onClick); i++; next(); } }, 1200);
  }
  next();
}

// ===== 이벤트 =====
startBtn.addEventListener('click', startGaze);
stopBtn.addEventListener('click', stopGaze);
calibrateBtn.addEventListener('click', calibrate);
