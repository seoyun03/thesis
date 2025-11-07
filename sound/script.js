/* ===========================================
   script.js — Dwell = Louder + Faster
   - Audio unlock hardened
   - Green: single beep (interval shrinks with dwell)
   - Yellow: burst (spacing & cycle shrink with dwell)
   - Red: rapid beeps (tick spacing shrinks with dwell)
=========================================== */

// ---------- DOM ----------
const grid = document.getElementById('grid');

// ---------- CSS Var helper ----------
const getVarPx = (name) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name).trim());

// ---------- Audio (Web Audio API) ----------
let AC = null, master = null, comp = null;
let primed = false;

function setupAudioNodes() {
  if (AC && master) return;

  AC = new (window.AudioContext || window.webkitAudioContext)();

  comp = AC.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 14;
  comp.ratio.value = 8;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;

  master = AC.createGain();
  master.gain.value = 0.95;

  comp.connect(master);
  master.connect(AC.destination);
}

function primeAudio() {
  if (!AC || primed) return;
  const o = AC.createOscillator();
  const g = AC.createGain();
  g.gain.value = 0; // 무음 펄스
  o.connect(g); g.connect(AC.destination);
  o.start();
  o.stop(AC.currentTime + 0.01);
  primed = true;
}

async function unlockAudio() {
  setupAudioNodes();
  if (AC.state === 'suspended') {
    try { await AC.resume(); } catch (e) {}
  }
  primeAudio();
}

const now = () => (AC ? AC.currentTime : 0);

// 모든 제스처에서 언락 시도
['pointerdown','pointerup','pointermove','click','keydown','touchstart','touchend','touchmove']
  .forEach(evt => window.addEventListener(evt, unlockAudio, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') unlockAudio();
});

// ---------- Dwell helpers ----------
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
// 0~T초에서 0→1로 선형 증가
function dwellNorm(block, T = 6){
  if (!AC || !block || !block._enterAt) return 0;
  const age = Math.max(0, now() - block._enterAt);
  return clamp01(age / T);
}
// 선형 보간
function lerp(a,b,t){ return a + (b - a) * t; }

// 볼륨: 0~6초 동안 base → max
function dwellVol(block, base = 0.6, max = 1.0) {
  const t = dwellNorm(block, 6);
  return Math.min(max, lerp(base, max, t));
}

// ---------- Beep Synthesis ----------
function playBeep({ freq = 880, dur = 0.12, vol = 0.7 } = {}) {
  if (!AC || AC.state !== 'running') return;
  const t = now();

  const o = AC.createOscillator();
  const g = AC.createGain();
  const f = AC.createBiquadFilter();

  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);

  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  f.Q.setValueAtTime(1.4, t);

  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  o.connect(f); f.connect(g); g.connect(comp);
  o.start(t); o.stop(t + dur);
}

// 레벨 상승 피드백(진입 즉시 1회)
function playLevelBlip(level = 0, vol = 0.65) {
  const base = [520, 880, 660, 980][Math.min(level, 3)];
  playBeep({ freq: base, dur: 0.1, vol });
}

// ---------- Adaptive Repeaters ----------
function startRepeater(block) {
  stopRepeater(block);

  const scheduleGreen = () => {
    if (!block._hovering) return;
    const vol = dwellVol(block, 0.55, 0.95);
    playBeep({ freq: 880, dur: 0.11, vol });

    // 700 → 220ms로 점점 빨라짐
    const t = dwellNorm(block, 6);
    const interval = lerp(700, 220, t);

    block._rep = setTimeout(scheduleGreen, interval);
    block._rep_isTimeout = true;
  };

  const scheduleYellow = () => {
    if (!block._hovering) return;
    const t = dwellNorm(block, 6);

    // 버스트 간 간격 110 → 60ms
    const gap = lerp(110, 60, t);
    // 사이클 길이 900 → 260ms
    const cycle = lerp(900, 260, t);

    const burstCount = 3;
    for (let i = 0; i < burstCount; i++) {
      const offset = i * gap;
      setTimeout(() => {
        if (!block._hovering) return;
        const f = 740 + Math.random() * 140;
        const vol = dwellVol(block, 0.6, 0.98);
        playBeep({ freq: f, dur: 0.095, vol });
      }, offset);
    }
    block._rep = setTimeout(scheduleYellow, cycle);
    block._rep_isTimeout = true;
  };

  const scheduleRed = () => {
    if (!block._hovering) return;

    // 120 → 45ms로 점점 빨라짐
    const t = dwellNorm(block, 6);
    const spacing = lerp(120, 45, t);

    const f = 900 + Math.random() * 240;
    const d = 0.07 + Math.random() * 0.03;
    const vol = dwellVol(block, 0.62, 1.0);
    playBeep({ freq: f, dur: d, vol });

    block._rep = setTimeout(scheduleRed, spacing);
    block._rep_isTimeout = true;
  };

  // 현재 레벨에 따라 해당 스케줄러 시작
  const runForLevel = () => {
    stopRepeater(block);
    const level = parseInt(block.dataset.level || '0', 10);
    if (!block._hovering || level === 0) return;

    if (level === 1) scheduleGreen();
    else if (level === 2) scheduleYellow();
    else scheduleRed();
  };

  // 시작 + 레벨 바뀔 때 재설정
  runForLevel();
  block._onLevelBumped = () => runForLevel();
}

function stopRepeater(block) {
  if (!block) return;
  if (block._rep_isTimeout) clearTimeout(block._rep);
  else if (block._rep) clearInterval(block._rep);
  block._rep = null;
  block._rep_isTimeout = false;
}

// ---------- Grid Layout ----------
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
      d.style.backgroundColor = '#5989dc';
      d.addEventListener('pointerenter', onEnter, { passive: true });
      d.addEventListener('pointerleave', onLeave, { passive: true });
      frag.appendChild(d);
    }
    grid.appendChild(frag);
  } else if (cur > total){
    for (let i = cur - 1; i >= total; i--) {
      const el = grid.children[i];
      stopRepeater(el);
      grid.removeChild(el);
    }
  }
}

// ---------- Interaction ----------
async function onEnter(e){
  await unlockAudio();
  const block = e.currentTarget;
  block._hovering = true;
  block._enterAt = now(); // 체류 시작 기록

  stepColor(block, true);
  startRepeater(block);
}

function onLeave(e){
  const block = e.currentTarget;
  block._hovering = false;
  stopRepeater(block);
  block._enterAt = null;
}

// 색 단계 상승: 0→1→2→3 (100ms 간격)
function stepColor(block, fromEnter = false){
  if (block._animating) return;
  const seq = ['#5989dc', '#00b200', '#ffd400', '#ff3b3b'];
  const ms  = 100;

  let level = parseInt(block.dataset.level || '0', 10);
  block._animating = true;

  function applyNext(){
    if (!block._hovering) { cleanup(); return; }
    if (level >= 3) {
      if (fromEnter) {
        const vol = dwellVol(block, 0.6, 0.95);
        playLevelBlip(level, vol);
      }
      cleanup();
      return;
    }

    level += 1;
    block.style.backgroundColor = seq[level];
    block.dataset.level = String(level);

    const vol = dwellVol(block, 0.6, 0.95);
    playLevelBlip(level, vol);

    if (typeof block._onLevelBumped === 'function') block._onLevelBumped();

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

  if (fromEnter && level >= 3) {
    const vol = dwellVol(block, 0.6, 0.95);
    playLevelBlip(level, vol);
  }
  applyNext();
}

// ---------- Boot ----------
layout();
addEventListener('resize', () => {
  clearTimeout(layout._t);
  layout._t = setTimeout(layout, 80);
});

// 초기 언락 시도
unlockAudio();
