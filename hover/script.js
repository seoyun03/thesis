const grid = document.getElementById('grid');

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
      d.addEventListener('pointerenter', stepColor);
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

/* ===== 색상 바뀐 블록만 깜빡이게 (블록별 랜덤 타이밍) ===== */
function stepColor(e){
  const block = e.currentTarget;
  if (block._animating) return;

  const seq = ['#5989dc', '#00b200', '#ffd400', '#ff3b3b'];
  const ms  = 100;

  let level = parseInt(block.dataset.level || '0', 10);
  block._hovering = true;
  block._animating = true;

  function applyNext(){
    if (!block._hovering) { cleanup(); return; }
    if (level >= 3) { cleanup(); return; }

    level += 1;
    block.style.backgroundColor = seq[level];
    block.dataset.level = String(level);

    // 🔹 색이 바뀐 '해당 블록만' 깜빡이게 + 블록별 랜덤 타이밍
    if (!block.classList.contains('blink')) {
      const dur   = (1.6 + Math.random() * 1.4).toFixed(2); // 1.6s ~ 3.0s
      const delay = (Math.random() * 2.0).toFixed(2);       // 0.00s ~ 2.00s
      block.style.animationDuration = `${dur}s`;
      block.style.animationDelay    = `${delay}s`;
      block.classList.add('blink');
    }

    if (level < 3) {
      block._timer = setTimeout(applyNext, ms);
    } else {
      cleanup();
    }
  }

  function cleanup(){
    block._animating = false;
    if (block._timer) { clearTimeout(block._timer); block._timer = null; }
  }

  const onLeave = () => {
    block._hovering = false;
    cleanup();
    block.removeEventListener('pointerleave', onLeave);
  };
  block.addEventListener('pointerleave', onLeave);

  applyNext();
}
