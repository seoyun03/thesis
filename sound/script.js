/* ===========================================
   script.js — Beep Patterns by Color Level (Audio Unlock Fixed)
   - Robust audio unlock on any user gesture (click/touch/move)
   - Silent prime pulse to satisfy iOS/Safari
   - Green: single beep / Yellow: small burst / Red: rapid beeps
=========================================== */

// ---------- DOM ----------
const grid = document.getElementById('grid');

// ---------- CSS Var helper ----------
const getVarPx = (name) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name).trim());

// ---------- Audio (Web Audio API) ----------
let AC = null, master = null, comp = null;
let audioReady = false;
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
  // iOS/Safari는 제스처 시점에 source start가 1회라도 있어야 함
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
  audioReady = (AC.state === 'running');
}

const now = () => (AC ? AC.currentTime : 0);

// 전역적으로 모든 제스처에서 언락 시도 (once 아님: 매번 보강)
['pointerdown','pointerup','pointermove','click','keydown','touchstart','touchend','touchmove']
  .forEach(evt => window.addEventListener(evt, unlockAudio, { passive: true }));

// 탭 비활성→재활성 시 재개
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') unlockAudio();
});

// ---------- Simple Beep Synthesis ----------
function playBeep({ freq = 880, dur = 0.12, vol = 0.7 } = {}) {
  if (!AC) return;
  if (AC.state !== 'running') return; // 잠겨 있으면 무음
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

// 레벨 상승 피드백
function playLevelBlip(level = 0) {
  const base = [520, 880, 660, 980][Math.min(level, 3)];
  playBeep({ freq: base, dur: 0.1, vol: 0.65 });
}

// ---------- Repeater: level에 따라 패턴/주기 ----------
/*
  level 0: 반복 없음
  level 1 (green): 1회 '삑' / 650ms
  level 2 (yellow): 3회 '삑' 버스트 / 800ms
  level 3 (red): 거의 연속 '삑' / 70~120ms 간격
*/
const cycleMsByLevel = [null, 650, 800, 120];

function startRepeater(block) {
  stopRepeater(block);

  let level = parseInt(block.dataset.level || '0', 10);
  const schedule = () => {
    level = parseInt(block.dataset.level || '0', 10);
    stopRepeater(block);
    if (!block._hovering || level === 0) return;

    if (level === 1) {
      // 초록: 한 번 '삑'
      block._rep = setInterval(() => {
        if (!block._hovering) return;
        unlockAudio(); // 혹시 또 잠기면 즉시 재개
        playBeep({ freq: 880, dur: 0.11, vol: 0.65 });
      }, cycleMsByLevel[1]);
    } else if (level === 2) {
      // 노랑: 3회 버스트
      block._rep = setInterval(() => {
        if (!block._hovering) return;
        unlockAudio();
        const burstCount = 3;
        for (let i = 0; i < burstCount; i++) {
          const offset = i * 110;
          setTimeout(() => {
            if (!block._hovering) return;
            const f = 740 + Math.random() * 140; // 미세 변조
            playBeep({ freq: f, dur: 0.095, vol: 0.62 });
          }, offset);
        }
      }, cycleMsByLevel[2]);
    } else {
      // 빨강: 빠른 반복 '삑'
      const tick = () => {
        if (!block._hovering) return;
        unlockAudio();
        const f = 900 + Math.random() * 240;
        const d = 0.07 + Math.random() * 0.03;
        const v = 0.62 + Math.random() * 0.1;
        playBeep({ freq: f, dur: d, vol: v });

        block._rep = setTimeout(tick, 70 + Math.random() * 50);
      };
      block._rep = setTimeout(tick, 0);
      block._rep_isTimeout = true;
    }
  };

  schedule();
  block._onLevelBumped = () => schedule();
}

function stopRepeater(block) {
  if (!block) return;
  if (block._rep_isTimeout) {
    clearTimeout(block._rep);
  } else if (block._rep) {
    clearInterval(block._rep);
  }
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
  await unlockAudio(); // hover만으로도 오디오 활성화
  const block = e.currentTarget;
  block._hovering = true;

  stepColor(block, true);   // 색 올리면서 레벨 블립
  startRepeater(block);     // 레벨 패턴 시작
}

function onLeave(e){
  const block = e.currentTarget;
  block._hovering = false;
  stopRepeater(block);
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
      if (fromEnter) playLevelBlip(level);
      cleanup();
      return;
    }

    level += 1;
    block.style.backgroundColor = seq[level];
    block.dataset.level = String(level);

    playLevelBlip(level);
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

  if (fromEnter && level >= 3) playLevelBlip(level);
  applyNext();
}

// ---------- Boot ----------
layout();
addEventListener('resize', () => {
  clearTimeout(layout._t);
  layout._t = setTimeout(layout, 80);
});

// 페이지 로드 직후에도 언락 시도(바로는 막혀도, 첫 제스처 때 보강)
unlockAudio();
