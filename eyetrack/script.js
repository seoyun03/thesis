// ===== DOM =====
const dot = document.getElementById('dot');
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const showCam  = document.getElementById('showCam');
const statusEl = document.getElementById('status');
const hintEl   = document.getElementById('hint');

function setStatus(text, color='#2a3cff'){ statusEl.textContent=text; statusEl.style.color=color; }

// ===== 시선 좌표 & 상태 (마우스 없음) =====
let haveGaze = false;
let gx = innerWidth/2, gy = innerHeight/2; // 최신 예측(뷰포트 기준)
let sx = gx, sy = gy;                      // 화면에 그릴 스무딩 좌표
let anchorX = gx, anchorY = gy;            // 현재 '머문 지점' 중심
let dwell = 0;                             // 같은 지점에서 머문 시간(초)
let lastTs = performance.now();
let wasVisible = false;

// 움직임/착시 방지용 파라미터
const POS_SMOOTH   = 0.18;  // 점 이동 부드러움 (낮을수록 더 천천히)
const STICK_RADIUS = 55;    // 같은 지점으로 판정할 반경(px)
const TARGET_DWELL = 2.0;   // 이 시간 머물면 빨간색 도달(초)

// 안정 샘플 필터(연속으로 일정 반경 내에 들어온 샘플일 때만 이동)
let stableX = gx, stableY = gy;
let stableCount = 0;
const STABLE_NEED = 3;   // 연속 샘플 N개
const STABLE_EPS  = 28;  // 이 반경 내면 안정으로 카운트

// 색상 맵: 0~1 → blue→green→yellow→red
function heatColor(t){
  const clamp = v => Math.max(0, Math.min(1, v));
  t = clamp(t);
  let r=0,g=0,b=0;
  if (t <= 1/3){          // blue -> green
    const k = t*3;
    r = 0; g = Math.round(255*k); b = Math.round(255*(1-k));
  } else if (t <= 2/3){   // green -> yellow
    const k = (t-1/3)*3;
    r = Math.round(255*k); g = 255; b = 0;
  } else {                // yellow -> red
    const k = (t-2/3)*3;
    r = 255; g = Math.round(255*(1-k)); b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

function placeDot(x,y,color){
  dot.style.transform = `translate(${x-8}px, ${y-8}px)`;
  dot.style.background = color;
}

function spawnGhost(x,y){
  const g = document.createElement('div');
  g.className = 'ghost';
  g.style.opacity = '0.9';
  g.style.transform = `translate(${x-7}px, ${y-7}px)`;
  document.body.appendChild(g);

  const DURATION = 900; // ms
  const start = performance.now();
  function step(t){
    const k = Math.min(1, (t - start) / DURATION);
    g.style.opacity = String(0.9 * (1 - k));
    const scale = 1 - 0.15*k;
    g.style.transform = `translate(${x-7}px, ${y-7}px) scale(${scale})`;
    if (k < 1) requestAnimationFrame(step);
    else g.remove();
  }
  requestAnimationFrame(step);
}

// 메인 루프
function loop(){
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTs)/1000);
  lastTs = now;

  if (haveGaze){
    // 안정 필터: 연속 샘플 판정
    const sdist = Math.hypot(gx - stableX, gy - stableY);
    if (sdist <= STABLE_EPS){
      stableCount++;
    } else {
      stableCount = 0;
      stableX = gx; stableY = gy;
    }

    // 안정된 경우에만 '타깃 좌표'를 현재 예측으로 사용
    const targetX = (stableCount >= STABLE_NEED) ? gx : sx;
    const targetY = (stableCount >= STABLE_NEED) ? gy : sy;

    // 같은 지점 머뭄 판단(앵커 기준)
    const dx = targetX - anchorX, dy = targetY - anchorY;
    const dist = Math.hypot(dx,dy);

    if (dist <= STICK_RADIUS){
      dwell += dt; // 같은 지점에서 머문 시간 증가
    } else {
      // 다른 지점으로 이동: 이전 지점에 파란 잔상
      if (wasVisible){ spawnGhost(sx, sy); }
      anchorX = targetX; anchorY = targetY;
      dwell = 0;
    }

    // 점 이동 스무딩
    sx += (targetX - sx) * POS_SMOOTH;
    sy += (targetY - sy) * POS_SMOOTH;

    // 색상 = dwell / TARGET_DWELL
    const color = heatColor(dwell / TARGET_DWELL);

    // 경계 클램프 후 표시
    const x = Math.max(0, Math.min(innerWidth,  sx));
    const y = Math.max(0, Math.min(innerHeight, sy));
    placeDot(x, y, color);
    wasVisible = true;
  } else {
    // 시선 예측이 끊기면 잔상 남기고 숨김
    if (wasVisible){
      const rect = dot.getBoundingClientRect();
      spawnGhost(rect.left+8, rect.top+8);
      dot.style.transform = 'translate(-1000px,-1000px)';
      wasVisible = false;
      dwell = 0;
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ===== WebGazer (마우스 대체 없음) =====
let running = false;

async function startGaze(){
  setStatus('requesting camera...');
  try { await navigator.mediaDevices.getUserMedia({ video:true, audio:false }); } catch(e){}
  setStatus('starting...');
  try{
    webgazer
      .setRegression('ridge')
      .setGazeListener((data)=>{
        if (!data){ haveGaze=false; return; }
        haveGaze = true;
        gx = data.x; gy = data.y;  // viewport 좌표
      })
      .showPredictionPoints(false)
      .begin();

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    setStatus('gaze running');
    hintEl.textContent = '한 지점에 오래 머물수록 점 색이 파→초→노→빨로 변합니다.';
  }catch(e){
    console.error(e);
    running=false;
    setStatus('gaze failed','#c62828');
    hintEl.textContent='카메라 접근 실패. 권한/조명을 확인하세요.';
  }
}

function stopGaze(){
  try { webgazer.pause(); webgazer.clearGazeListener(); } catch(e){}
  running=false;
  startBtn.disabled=false;
  stopBtn.disabled=true;
  setStatus('stopped','#777');
  haveGaze=false;
}

// 카메라 피드 토글
showCam.addEventListener('change', ()=>{
  const feed = document.getElementById('webgazerVideoFeed');
  if (feed) feed.style.display = showCam.checked ? 'block' : 'none';
});

// 캘리브레이션(9점)
function calibrate(){
  const pts = [
    [0.1,0.1],[0.5,0.1],[0.9,0.1],
    [0.1,0.5],[0.5,0.5],[0.9,0.5],
    [0.1,0.9],[0.5,0.9],[0.9,0.9],
  ];
  let i=0;
  const d=document.createElement('div');
  d.className='cal-dot';
  document.body.appendChild(d);
  function next(){
    if (i>=pts.length){ d.remove(); hintEl.textContent='캘리브레이션 완료!'; return; }
    const [rx,ry]=pts[i];
    d.style.left = `${rx*innerWidth}px`;
    d.style.top  = `${ry*innerHeight}px`;
    hintEl.textContent=`Calibrate: 점을 바라보고 클릭 (${i+1}/${pts.length})`;
    let clicked=false;
    const onClick=()=>{clicked=true; removeEventListener('click',onClick); i++; setTimeout(next,200);};
    addEventListener('click',onClick);
    setTimeout(()=>{ if(!clicked){ removeEventListener('click',onClick); i++; next(); } },1200);
  }
  next();
}

// 이벤트
startBtn.addEventListener('click', startGaze);
stopBtn.addEventListener('click', stopGaze);
calibrateBtn.addEventListener('click', calibrate);
