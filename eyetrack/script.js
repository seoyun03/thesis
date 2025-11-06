/***** Grid 생성 *****/
const grid = document.getElementById('grid');
const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');
const dot = document.getElementById('dot');

const getVarPx = (name) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name).trim());

function layout(){
  const bs  = getVarPx('--block-size');
  const gap = getVarPx('--gap');

  const rect = grid.getBoundingClientRect();
  const cols = Math.max(1, Math.floor((rect.width  + gap) / (bs + gap)));
  const rows = Math.max(1, Math.floor((rect.height + gap) / (bs + gap)));
  const total = cols * rows;

  grid.style.gridTemplateColumns = `repeat(${cols}, var(--block-size))`;

  const cur = grid.children.length;
  if (cur < total){
    const frag = document.createDocumentFragment();
    for (let i = cur; i < total; i++){
      const d = document.createElement('div');
      d.className = 'block';
      d.dataset.level = '0'; // 0: 파랑, 1: 초록, 2: 노랑, 3: 빨강
      frag.appendChild(d);
    }
    grid.appendChild(frag);
  } else if (cur > total){
    for (let i = cur - 1; i >= total; i--) grid.removeChild(grid.children[i]);
  }
}
layout();
addEventListener('resize', () => {
  clearTimeout(layout._t);
  layout._t = setTimeout(layout, 50);
});

/***** 색상 단계 정의 *****/
const SEQ = ['#5989dc', '#00b200', '#ffd400', '#ff3b3b']; // 파랑→초록→노랑→빨강
const STEP_MS = 120; // 같은 칸에 머물 때 단계 간격

function bumpBlockLevel(block){
  let level = parseInt(block.dataset.level || '0', 10);
  if (level >= 3 || block._animating) return;
  block._animating = true;

  level += 1;
  block.dataset.level = String(level);
  block.style.backgroundColor = SEQ[level];

  setTimeout(()=>{ block._animating = false; }, STEP_MS);
}

/***** 시선 추적: 시작은 사용자 클릭으로 (브라우저 제한 회피) *****/
let lastBlock = null;
let lastSeenAt = 0;

startBtn.addEventListener('click', async () => {
  try {
    statusEl.textContent = '카메라 요청 중…';
    await webgazer.setRegression('ridge')
                  .setGazeListener(onGaze)
                  .showVideoPreview(true)          // 초기엔 켜서 권한/프레임 확인
                  .showPredictionPoints(false)
                  .begin();
    statusEl.textContent = '시작됨 (웹캠 허용 OK)';
    // 잠시 후 영상 미리보기 숨김
    setTimeout(()=>{
      webgazer.showVideoPreview(false);
      statusEl.textContent = '추적 중';
    }, 1500);
  } catch (e) {
    console.error(e);
    statusEl.textContent = '시작 실패: HTTPS/권한 확인';
  }
});

function onGaze(data, ts){
  if (!data) return;

  // 1) 디버그 도트 이동 (예측 좌표 확인)
  dot.style.transform = `translate(${data.x - 5}px, ${data.y - 5}px)`;

  // 2) 좌표가 그리드 블록 위인지 확인
  const x = data.x, y = data.y;
  if (!(x >= 0 && y >= 0)) return;
  const el = document.elementFromPoint(x, y);
  if (!el || !el.classList || !el.classList.contains('block')) {
    lastBlock = null;
    return;
  }

  // 같은 블록에 머물 때만 진행
  if (el !== lastBlock) {
    lastBlock = el;
    lastSeenAt = ts;
    return;
  }

  if (ts - lastSeenAt >= STEP_MS) {
    lastSeenAt = ts;
    bumpBlockLevel(el);
  }
}

/***** (선택) 입력 없을 때 서서히 식히기 *****/
let lastInput = performance.now();
addEventListener('mousemove', ()=> lastInput = performance.now());
addEventListener('keydown',  ()=> lastInput = performance.now());
setInterval(()=>{
  const idle = performance.now() - lastInput > 5000;
  if (!idle) return;
  [...grid.children].forEach(b=>{
    const lvl = parseInt(b.dataset.level||'0',10);
    if (lvl > 0) {
      b.dataset.level = String(lvl - 1);
      b.style.backgroundColor = SEQ[lvl - 1];
    }
  });
}, 1200);
