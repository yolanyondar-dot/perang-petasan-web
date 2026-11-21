/**
 * audio.js — synthesizer SFX prosedural via Web Audio API (tanpa file eksternal).
 */

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = false;
let unlocked = false;
let lastExplosionAt = 0;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);
  return ctx;
}

function getNoiseBuffer() {
  const c = ensureCtx();
  if (!c) return null;
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const len = c.sampleRate * 1.0;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return noiseBuffer;
}

function now() {
  const c = ensureCtx();
  return c ? c.currentTime : 0;
}

export function unlockAudio() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  if (unlocked) return;
  unlocked = true;
  // tiny silent tick to fully unlock on some browsers
  try {
    const g = c.createGain();
    g.gain.value = 0.0001;
    const o = c.createOscillator();
    o.connect(g); g.connect(master);
    o.start();
    o.stop(c.currentTime + 0.01);
  } catch (_) {}
}

export function setMuted(v) {
  muted = !!v;
  const c = ensureCtx();
  if (c && master) master.gain.setTargetAtTime(muted ? 0 : 0.8, c.currentTime, 0.01);
  return muted;
}

export function toggleMute() { return setMuted(!muted); }
export function isMuted() { return muted; }

function canPlay() {
  const c = ensureCtx();
  return !!(c && master && c.state !== 'closed');
}

export function playFuse() {
  if (!canPlay()) return;
  const c = ensureCtx(); unlockAudio();
  const t = now();
  const buf = getNoiseBuffer();
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2200, t);
  bp.Q.value = 2.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.035, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t);
  src.stop(t + 0.25);
}

export function playThrow() {
  if (!canPlay()) return;
  const c = ensureCtx(); unlockAudio();
  const t = now();
  const buf = getNoiseBuffer();
  if (buf) {
    const src = c.createBufferSource(); src.buffer = buf;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.18);
  }
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(220, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(0.04, t + 0.01);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(g2); g2.connect(master);
  o.start(t); o.stop(t + 0.15);
}

export function playPunch() {
  if (!canPlay()) return;
  const c = ensureCtx(); unlockAudio();
  const t = now();
  const buf = getNoiseBuffer();
  if (buf) {
    const src = c.createBufferSource(); src.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(400, t + 0.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.13);
  }
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.08);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g2); g2.connect(master);
  o.start(t); o.stop(t + 0.13);
}

export function playExplosion(intensity = 1) {
  if (!canPlay()) return;
  const c = ensureCtx(); unlockAudio();
  const t0 = now();
  // throttle agar renteng pop-pop-pop tidak menumpuk berlebihan
  if (t0 - lastExplosionAt < 0.03) return;
  lastExplosionAt = t0;
  const k = Math.max(0.25, Math.min(1.8, Number(intensity) || 1));
  const buf = getNoiseBuffer();
  if (buf) {
    const src = c.createBufferSource(); src.buffer = buf;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800 * k, t0);
    lp.frequency.exponentialRampToValueAtTime(120, t0 + 0.45 * k);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.22 * k, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55 * k);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + 0.6 * k);
  }
  // low-end thump
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(120 * k + 40, t0);
  o.frequency.exponentialRampToValueAtTime(28, t0 + 0.35 * k);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0.0001, t0);
  g2.gain.exponentialRampToValueAtTime(0.35 * k, t0 + 0.008);
  g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45 * k);
  o.connect(g2); g2.connect(master);
  o.start(t0); o.stop(t0 + 0.5 * k);
}

export function playRingOut() {
  if (!canPlay()) return;
  const c = ensureCtx(); unlockAudio();
  const t = now();
  const o = c.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.6);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
  o.connect(lp); lp.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.7);
}

export function playWin() {
  if (!canPlay()) return;
  const c = ensureCtx(); unlockAudio();
  const t = now();
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f, t + i * 0.08);
    const g = c.createGain();
    const s = t + i * 0.08;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.07, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.28);
    o.connect(g); g.connect(master);
    o.start(s); o.stop(s + 0.3);
  });
}