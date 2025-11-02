// =====================
// (1) HEATMAP (네 기존 로직 유지)
// =====================
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d', { alpha: false });
const DPR = Math.max(1, Math.floor(window.devicePixelRatio || 1));

let cell, cols, rows, heat;
resize();
window.addEventListener('resize', ()=>{ resize(); layoutWords(); });

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

// 색상 그라데이션
const stops = [
  { t: 0.00, c: [  0, 0, 0] },
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

  const rMin = 3;
  const rMaxBase = 60;
  const timeToMax = 3.5;
  const gamma = 1.2;
  let t = Math.min(1, dwellSec / timeToMax);
  t = Math.pow(t, gamma);
  let radius = Math.floor(rMin + (rMaxBase - rMin) * t);

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

  // 냉각
  const COOL = 0.0015;
  for (let k = 0; k < heat.length; k++) {
    heat[k] = Math.max(0, heat[k] - COOL);
  }

  // 렌더링
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

  // 자동 트리거 (아이들 상태)
  autoDistortTick(now);
})();

// =====================
// (2) 화면 왜곡 강도 제어
// =====================
const svgDisplace = document.querySelector('#distortFilter feDisplacementMap');
function setDistortEase(ease){
  document.documentElement.style.setProperty('--distort', ease.toFixed(3));
  svgDisplace.setAttribute('scale', String(200 * ease));
}
function distortPulse(strength=1, ms=1000){
  const start = performance.now();
  function frame(t){
    const k = Math.min(1, (t - start)/ms);
    const e = Math.sin(k*Math.PI) * strength;
    setDistortEase(e);
    if (k<1) requestAnimationFrame(frame);
    else setDistortEase(0);
  }
  requestAnimationFrame(frame);
}

// =====================
// (3) 떠 있는 텍스트 생성/이펙트
// =====================
const floating = document.getElementById('floating');

// 원하는 문장들 (추가/변경 자유)
const WORDS = [
  "the screen bends",
  "your eyes glitch",
  "light lingers",
  "a trace remains",
  "blur between",
  "you blink, but it stays",
  "afterimage mode",
  "your space distorts",
  "stars in the dark",
  "focus flickers",
  "lost in light"
];

const COUNT = 8; // 한번에 띄울 텍스트 개수
const nodes = [];

function layoutWords(){
  const w = innerWidth;
  const h = innerHeight;
  const margin = 64;

  nodes.forEach(n => n.el.remove());
  nodes.length = 0;

  // 무작위로 배치하되 겹침을 줄이기 위한 간단한 시도
  const spots = [];
  for (let i=0; i<COUNT; i++){
    let tries = 20, x=0, y=0;
    do{
      x = margin + Math.random()*(w - margin*2);
      y = margin + Math.random()*(h - margin*2);
      tries--;
    }while(tries>0 && spots.some(s => Math.hypot(s.x-x, s.y-y) < 140));
    spots.push({x,y});
  }

  for (let i=0; i<COUNT; i++){
    const text = WORDS[i % WORDS.length];
    const el = document.createElement('span');
    el.className = 'word ' + (i%3===0 ? 'l' : i%3===1 ? 'm' : 's');
    el.style.left = `${spots[i].x}px`;
    el.style.top  = `${spots[i].y}px`;
    el.textContent = text;
    el.dataset.txt = text; // ::before/::after
    floating.appendChild(el);
    nodes.push({el, x:spots[i].x, y:spots[i].y, state:'idle'});
  }
}
layoutWords();

// 랜덤으로 일부에 glitch 부여
function glitchSome(count=3, dur=900){
  const pick = shuffle(nodes).slice(0, count);
  pick.forEach(n=>{
    if (n.state==='drop') return;
    n.el.classList.add('glitch');
    setTimeout(()=> n.el.classList.remove('glitch'), dur);
  });
}

// 랜덤으로 일부를 깜빡이게
function blinkSome(count = 3, dur = 3000){
  const pick = shuffle(nodes.filter(n => n.state !== 'drop')).slice(0, count);
  pick.forEach(n => {
    n.el.style.setProperty('--blink-delay', `${(Math.random()*1.1).toFixed(2)}s`);
    n.el.classList.add('blink');
    setTimeout(() => {
      n.el.classList.remove('blink');
      n.el.style.removeProperty('--blink-delay');
    }, dur);
  });
}

// 랜덤으로 일부 떨어뜨리기
function dropSome(count=2){
  const pick = shuffle(nodes.filter(n=>n.state!=='drop')).slice(0, count);
  pick.forEach(n=>{
    n.state='drop';
    n.el.classList.remove('blink');   // 드롭 중 깜빡임 제거
    n.el.classList.add('drop');
    // 떨어진 후 재생성(다른 위치에 다시 등장)
    setTimeout(()=>{
      n.el.classList.remove('drop','glitch','blink');
      n.state='idle';
      // 새 위치
      const w = innerWidth, h = innerHeight, m = 64;
      n.x = m + Math.random()*(w - m*2);
      n.y = m + Math.random()*(h - m*2);
      n.el.style.left = `${n.x}px`;
      n.el.style.top  = `${n.y}px`;
      // 살짝 글리치로 복귀 강조
      n.el.classList.add('glitch');
      setTimeout(()=> n.el.classList.remove('glitch'), 600);
    }, 700); // dropOut 0.7s와 동기화
  });
}

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j = (Math.random()*(i+1))|0;
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

// 입력 이벤트에 반응
window.addEventListener('mousemove', throttle(()=>{
  glitchSome(3, 900);
  blinkSome(1, 1800);
  distortPulse(.6, 800);
}, 1400));

window.addEventListener('click', ()=>{
  glitchSome(5, 1200);
  blinkSome(2, 2200);
  dropSome(1);
  distortPulse(1, 1000);
});

// 주기적으로도 약간씩 깜빡이게
setInterval(() => blinkSome(2, 2600), 2200);

// 아이들 상태면 자동으로 글리치/드롭/왜곡
let lastAuto = 0;
function autoDistortTick(now){
  const IDLE_MS = 9000;
  if (now - lastMove > IDLE_MS && now - lastAuto > IDLE_MS){
    glitchSome(4, 1100);
    dropSome(1);
    distortPulse(.9, 1100);
    lastAuto = now;
  }
}

// 간단 스로틀
function throttle(fn, wait){
  let last = 0;
  return function(...args){
    const now = Date.now();
    if (now - last > wait){
      last = now;
      fn.apply(this, args);
    }
  }
}
