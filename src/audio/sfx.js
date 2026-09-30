// Tiny synthesized sound effects for match events — no audio files, no
// Phaser sound manager, just the browser's own Web Audio API generating
// short square/triangle-wave blips. Chosen over sampled audio to match the
// existing retro nes.css pixel-art look with zero binary assets and zero
// licensing surface (see the plan this was built from).
//
// The AudioContext is created lazily, on the first call after a user
// gesture (e.g. the landing "Play" click) — browsers block audio from
// starting before any interaction, so creating it any earlier would just
// leave it permanently suspended.

const SFX_KEY = 'inazuma-clone:sfx:v1';

let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isSfxEnabled() {
  try { return localStorage.getItem(SFX_KEY) !== 'off'; } catch { return true; }
}
export function setSfxEnabled(enabled) {
  try { localStorage.setItem(SFX_KEY, enabled ? 'on' : 'off'); } catch { /* storage unavailable */ }
}

/** Plays a single tone: `freq` in Hz, `duration` in seconds, `type` an
 *  oscillator waveform, `startAt`/`gain` letting callers stack a few of
 *  these into a short tune. A short linear fade-out avoids the audible
 *  click a hard stop would otherwise leave. */
function tone(freq, duration, { type = 'square', gain = 0.15, startAt = 0 } = {}) {
  if (!isSfxEnabled()) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + startAt;
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(env).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

/** A short, low-pitched blip for a kick/shot. */
export function playKick() {
  tone(220, 0.08, { type: 'square', gain: 0.18 });
}

/** A lighter, higher-pitched tick for a pass — distinct from a kick without
 *  competing with it for attention. */
export function playPass() {
  tone(440, 0.05, { type: 'triangle', gain: 0.1 });
}

/** A quick ascending three-note fanfare for a goal. */
export function playGoal() {
  tone(523.25, 0.12, { type: 'square', gain: 0.2, startAt: 0 });
  tone(659.25, 0.12, { type: 'square', gain: 0.2, startAt: 0.1 });
  tone(783.99, 0.22, { type: 'square', gain: 0.22, startAt: 0.2 });
}

/** A sharp descending two-note parry/catch for a goalkeeper save — distinct
 *  from a kick (single low blip) or a block (not modeled yet) by dropping
 *  pitch instead of staying flat or rising. */
export function playGkSave() {
  tone(660, 0.07, { type: 'triangle', gain: 0.2, startAt: 0 });
  tone(330, 0.12, { type: 'triangle', gain: 0.16, startAt: 0.05 });
}

/** A flat double-note whistle for kickoff/full-time. */
export function playWhistle() {
  tone(1046.5, 0.18, { type: 'sawtooth', gain: 0.12, startAt: 0 });
  tone(1046.5, 0.18, { type: 'sawtooth', gain: 0.12, startAt: 0.25 });
}
