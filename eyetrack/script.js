// ===== DOM =====
const dot = document.getElementById('dot');
const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const calibrateBtn = document.getElementById('calibrateBtn');
const showCam  = document.getElementById('showCam');
const statusEl = document.getElementById('status');
const hintEl   = document.getElementById('hint');
function setStatus(text, color='#2a3cff'){ statusEl.textContent=text; statusEl.style.color=color; }

// ===== 상태 =====
let haveGaze = false;
let lastSampleAt = 0;                      // 마지막 시선 샘플(ms)
let rx = innerWidth/2, ry = innerHeight/2; // 최신 원시(raw) 좌표
let gx = rx, gy = ry;                      // 필터 후 좌표(보정 전)
let sx = gx, sy = gy;                      // 화면에 그릴 좌표(보정 후 + 스무딩)
let anchorX = sx, anchorY = sy;            // "머문 지점" 기준
let dwell = 0;                             // 머문 시간(초)
let lastTs = performance.now();
let wasVisible = false;

// ===== 정확도/안정성 파라미터 =====
const TAU = 0.20;              // 지수 스무딩(초): ↓ 민첩 / ↑ 묵직
const HOLD_NO_SAMPLE_SEC = 0.6;// 샘플 잠깐 끊겨도 유지
const STICK_IN  = 45;          // 앵커 “들어옴”
const STICK_OUT = 65;          // 앵커 “이탈”
const TARGET_DWELL = 2.0;      // 빨강까지 시간(초)
const BASE_R = 10;             // 점 기본 반지름(px)
const MAX_R  = 26;             // 점 최대 반지름(px)
const MAX_FRAME_JUMP = 160;    // 프레임 점프 거부(px)
const QN = 5;                  // 중앙값 필터 길이

// 중앙값 필터 큐
const qx = [], qy = [];
function pushMedian(x, y){
  qx.push(x); qy.push(y);
  if (qx.length > QN){ qx.shift(); qy.shift(); }
  const sx = [...qx].sort((a,b)=>a-b);
  const sy = [...qy].sort((a,b)=>a-b);
  const mid = Math.floor(sx.length/2);
  return [sx[mid], sy[mid]];
}

// 색상 맵(0~1 → blue→green→yellow→red)
function heatColor01(t){
  t = Math.max(0, Math.min(1, t));
  const e = t*t*(3-2*t); // smoothstep
  let r=0,g=0,b=0;
  if (e <= 1/3){
    const k = e*3;      r=0;          g=Math.round(255*k); b=Math.round(255*(1-k));
  } else if (e <= 2/3){
    const k = (e-1/3)*3; r=Math.round(255*k); g=255;        b=0;
  } else {
    const k = (e-2/3)*3; r=255;        g=Math.round(255*(1-k)); b=0;
  }
  return `rgb(${r},${g},${b})`;
}

function placeDot(x, y, radiusPx, color){
  const d = Math.max(8, Math.round(radiusPx))*2;
  dot.style.width  = `${d}px`;
  dot.style.height = `${d}px`;
  dot.style.transform = `translate(${x - d/2}px, ${y - d/2}px)`;
  dot.style.background = color;
  dot.style.boxShadow  = `0 0 ${Math.round(radiusPx)}px rgba(0,0,0,0.35)`;
}

// ===== 보정(캘리브레이션) 행렬: raw -> corrected =====
// 2x3 affine: [x' y' 1] * A = [X Y]
// 내부 표현은 A = [[a11,a12,a13],[a21,a22,a23]]
let A = [[1,0,0],[0,1,0]]; // 초깃값: 항등

function applyAff(x, y){
  return [
    x*A[0][0] + y*A[0][1] + A[0][2],
    x*A[1][0] + y*A[1][1] + A[1][2],
  ];
}

// 최소자승으로 2×3 행렬 풀기
function computeAffine(rawPts, scrPts){
  // rawPts[i] = [x,y], scrPts[i] = [X,Y]
  // M * a = b 형태 구성 (a = 6x1 벡터)
  const n = rawPts.length;
  if (n < 3) return [[1,0,0],[0,1,0]];
  // 행렬 요소 누적
  let Sxx=0,Sxy=0,Sx1=0,Syy=0,Sy1=0,S11=n;
  let SX=0,SY=0,SxX=0,SyX=0,SxY=0,SyY=0;
  for (let i=0;i<n;i++){
    const x=rawPts[i][0], y=rawPts[i][1];
    const X=scrPts[i][0], Y=scrPts[i][1];
    Sxx+=x*x; Sxy+=x*y; Sx1+=x;
    Syy+=y*y; Sy1+=y;
    SX+=X; SY+=Y;
    SxX+=x*X; SyX+=y*X;
    SxY+=x*Y; SyY+=y*Y;
  }
  // 정규방정식 3x3 두 번(각 채널 X/Y)을 푼다.
  function solve3x3(Bx0,Bx1,Bx2){
    // [ [Sxx,Sxy,Sx1],[Sxy,Syy,Sy1],[Sx1,Sy1,S11] ] * [a,b,c] = [Bx0,Bx1,Bx2]
    const m00=Sxx,m01=Sxy,m02=Sx1;
    const m10=Sxy,m11=Syy,m12=Sy1;
    const m20=Sx1,m21=Sy1,m22=S11;
    const det =
      m00*(m11*m22 - m12*m21) -
      m01*(m10*m22 - m12*m20) +
      m02*(m10*m21 - m11*m20);
    if (Math.abs(det) < 1e-6) return [1,0,0]; // 퇴화 시 항등
    function det3(a00,a01,a02,a10,a11,a12,a20,a21,a22){
      return a00*(a11*a22 - a12*a21) - a01*(a10*a22 - a12*a20) + a02*(a10*a21 - a11*a20);
    }
    const a = det3(Bx0,m01,m02, Bx1,m11,m12, Bx2,m21,m22)/det;
    const b = det3(m00,Bx0,m02, m10,Bx1,m12, m20,Bx2,m22)/det;
    const c = det3(m00,m01,Bx0, m10,m11,Bx1, m20,m21,Bx2)/det;
    return [a,b,c];
  }
  const [a11,a12,a13] = solve3x3(SxX, SyX, SX);
  const [a21,a22,a23] = solve3x3(SxY, SyY, SY);
  return [[a11,a12,a13],[a21,a22,a23]];
}

// ===== 캘리브레이션 (9점, 각 점에서 raw 수집 → 보정행렬 학습) =====
async function runCalibration(){
  hintEl.textContent = '캘리브레이션: 점이 나타나면 그 지점을 응시하세요.';
  const pts = [
    [0.1,0.1],[0.5,0.1],[0.9,0.1],
    [0.1,0.5],[0.5,0.5],[0.9,0.5],
    [0.1,0.9],[0.5,0.9],[0.9,0.9],
  ];
  const rawSamples = []; // [[x,y], ...] (평균 raw)
  const scrTargets = []; // [[X,Y], ...] (실제 점 좌표)

  // 수집 헬퍼: 300ms 동안 raw를 모아 중앙값/평균
  async function collectAt(X, Y){
    const tmp = [];
    const start = performance.now();
    while (performance.now() - start < 300){
      if (haveGaze) tmp.push([rx, ry]);
      await new Promise(r=>requestAnimationFrame(r));
    }
    if (tmp.length === 0) return null;
    // 중앙값 기반 대표값
    const xs = tmp.map(p=>p[0]).sort((a,b)=>a-b);
    const ys = tmp.map(p=>p[1]).sort((a,b)=>a-b);
    const mx = xs[Math.floor(xs.length/2)];
    const my = ys[Math.floor(ys.length/2)];
    return [[mx, my], [X, Y]];
  }

  // 화면에 점 표시하며 순차 수집
  const d=document.createElement('div');
  d.className='cal-dot'; document.body.appendChild(d);

  for (let i=0;i<pts.length;i++){
    const [rxp, ryp] = pts[i];
    const X = rxp * innerWidth;
    const Y = ryp * innerHeight;
    d.style.left = `${X}px`; d.style.top = `${Y}px`;
    hintEl.textContent = `캘리브레이션: 점을 응시하세요 (${i+1}/9)`;
    const pair = await collectAt(X, Y);
    if (pair){
      rawSamples.push(pair[0]);
      scrTargets.push(pair[1]);
    }
    // 짧은 휴식
    await new Promise(r=>setTimeout(r, 120));
  }
  d.remove();

  if (rawSamples.length >= 4){
    // 약한 이상치 제거(큰 오차 상위 10% 컷)
    const prelim = computeAffine(rawSamples, scrTargets);
    function errOf(i){
      const p = rawSamples[i], t = scrTargets[i];
      const c = [
        p[0]*prelim[0][0] + p[1]*prelim[0][1] + prelim[0][2],
        p[0]*prelim[1][0] + p[1]*prelim[1][1] + prelim[1][2],
      ];
      return Math.hypot(c[0]-t[0], c[1]-t[1]);
    }
    const idx = rawSamples.map((_,i)=>i);
    idx.sort((a,b)=>errOf(a)-errOf(b));
    const keep = idx.slice(0, Math.ceil(idx.length*0.9)); // 상위 90%만 사용
    const r2 = keep.map(i=>rawSamples[i]);
    const s2 = keep.map(i=>scrTargets[i]);
    A = computeAffine(r2, s2);
    hintEl.textContent = '캘리브레이션 완료! (보정 적용됨)';
  } else {
    A = [[1,0,0],[0,1,0]];
    hintEl.textContent = '캘리브레이션 데이터 부족(4점 미만). 기본 보정으로 동작합니다.';
  }
}

// ===== 메인 루프 =====
function loop(){
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTs)/1000);
  lastTs = now;

  const recently = (now - lastSampleAt) <= HOLD_NO_SAMPLE_SEC*1000;

  if (haveGaze || recently){
    // 1) raw(rx,ry) -> 중앙값 필터 반영된 gx,gy는 listener에서 갱신됨
    // 2) 보정행렬 적용: 보정된 관측값 cx, cy
    const [cx, cy] = applyAff(gx, gy);

    // 3) 위치 스무딩(프레임레이트 독립)
    const alpha = 1 - Math.exp(-dt / TAU);
    sx += (cx - sx) * alpha;
    sy += (cy - sy) * alpha;

    // 4) 머묾 판정(히스테리시스)
    const dx = sx - anchorX, dy = sy - anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist <= STICK_IN){
      dwell += dt;
    } else if (dist >= STICK_OUT){
      anchorX = sx; anchorY = sy;
      dwell = 0; // 새 지점은 파란색부터 다시
    }

    // 5) 색/크기
    const t = Math.max(0, Math.min(1, dwell / TARGET_DWELL));
    const color = heatColor01(t);
    const easeT = t*t*(3-2*t);
    const radius = BASE_R + (MAX_R - BASE_R) * easeT;

    // 6) 표기
    const x = Math.max(0, Math.min(innerWidth,  sx));
    const y = Math.max(0, Math.min(innerHeight, sy));
    placeDot(x, y, radius, color);
    wasVisible = true;
  } else {
    if (wasVisible){
      dot.style.transform = 'translate(-1000px,-1000px)';
      wasVisible = false;
      dwell = 0;
    }
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ===== WebGazer (정확도 setup + 필터링) =====
let running = false;
async function startGaze(){
  setStatus('requesting camera...');
  try {
    await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height:{ ideal: 720  },
        frameRate: { ideal: 60, max: 60 }
      },
      audio: false
    });
  } catch(e){ /* 권한 팝업 트리거 용도라 무시 */ }

  setStatus('starting...');
  try{
    webgazer
      .setRegression('ridge')            // ridge가 대체로 안정적
      // .setRegression('weightedRidge') // 환경에 따라 이게 더 나을 때도 있음
      .setGazeListener((data)=>{
        if (!data){ haveGaze=false; return; }
        lastSampleAt = performance.now();

        // 화면 밖/NaN 필터
        if (!(data.x>=0 && data.y>=0 && data.x<=innerWidth && data.y<=innerHeight)) return;

        // raw → 중앙값 필터
        [gx, gy] = pushMedian(data.x, data.y);

        // 프레임 점프 거부
        const jump = Math.hypot(gx - rx, gy - ry);
        if (jump > MAX_FRAME_JUMP) return;

        rx = gx; ry = gy;
        haveGaze = true;
      })
      .showPredictionPoints(false)
      .begin();

    running = true;
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    setStatus('gaze running');
    hintEl.textContent = '정확도를 높이려면 Calibrate를 진행하세요.';
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

// ===== 캘리브레이션 버튼 =====
async function calibrate(){
  // 보정 전 스무딩을 잠시 약하게 해도 되지만, 간단히 현재 상태로 수집
  await runCalibration();
}

// 이벤트
startBtn.addEventListener('click', startGaze);
stopBtn.addEventListener('click', stopGaze);
calibrateBtn.addEventListener('click', calibrate);
