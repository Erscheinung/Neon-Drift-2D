// ============================================================
// NEON DRIFT — WEBAUDIO SYNTH MODULE
// Synth-only. No external assets. Lazy AudioContext (autoplay-safe).
// ============================================================

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

const MASTER_GAIN   = 0.35;  // modest headroom so stacked sounds stay clean
const LIMIT_THRESH  = 0.7;   // WaveShaper knee: soft-clip above this
const NOISE_SECONDS = 1;     // length of the reusable crash-noise buffer

// Pentatonic-ish rising set for combo chimes, indexed by tier.
// Base note climbs with multiplier: x1 -> x2 -> x3 -> x5.
const COMBO_NOTES = {
  1: [523.25, 659.25, 783.99],       // C5 E5 G5
  2: [659.25, 830.61, 987.77],       // E5 G#5 B5
  3: [783.99, 987.77, 1174.66],      // G5 B5 D6
  5: [1046.5, 1318.5, 1567.98],      // C6 E6 G6
};

// ------------------------------------------------------------
// SINGLETON STATE
// ------------------------------------------------------------

let ctx      = null;
let master   = null;   // master GainNode -> limiter -> destination
let limiter  = null;   // WaveShaper acting as a soft-clip safety net
let noiseBuf = null;   // shared white-noise buffer for the crash burst
let muted    = false;

// Soft-clip curve: linear until LIMIT_THRESH, then compress toward +/-1 with
// tanh so simultaneous SFX peaks fold gracefully instead of hard-clipping.
function makeLimiterCurve() {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= LIMIT_THRESH
      ? x
      : Math.sign(x) * (LIMIT_THRESH + (1 - LIMIT_THRESH) * Math.tanh((a - LIMIT_THRESH) / (1 - LIMIT_THRESH)));
  }
  return curve;
}

function buildNoiseBuffer() {
  const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Create context lazily; browsers block audio until a user gesture, so this is
// safe to call before unlock() but produces sound only once resumed.
function ensureContext() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  limiter = ctx.createWaveShaper();
  limiter.curve = makeLimiterCurve();
  limiter.oversample = '2x';

  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;

  master.connect(limiter);
  limiter.connect(ctx.destination);

  noiseBuf = buildNoiseBuffer();
}

// ------------------------------------------------------------
// VOICE HELPERS
// ------------------------------------------------------------

// One oscillator through its own gain envelope into the master bus. Returns
// the gain node so callers can shape attack/decay; osc auto-stops at `stop`.
function tone(type, freq, start, stop, peak) {
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  osc.connect(g);
  g.connect(master);
  osc.start(start);
  osc.stop(stop);
  return { osc, g, peak };
}

// Standard AD envelope: fast attack to peak, exponential decay to silence.
function envelope(g, start, attack, peak, decay) {
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

// ------------------------------------------------------------
// SFX
// ------------------------------------------------------------

// Rising whoosh — sawtooth sweeping up plus a filtered noise sheen.
function boost() {
  if (!playable()) return;
  const t = ctx.currentTime;
  const dur = 0.32;

  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(720, t + dur);
  envelope(g, t, 0.02, 0.28, dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);

  // Airy noise sweep layered on top
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(600, t);
  bp.frequency.exponentialRampToValueAtTime(2400, t + dur);
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  envelope(ng, t, 0.02, 0.12, dur);
  src.connect(bp); bp.connect(ng); ng.connect(master);
  src.start(t); src.stop(t + dur + 0.05);
}

// Thud on landing — low sine drop, gain scaled by impact velocity magnitude.
function land(impactVelocity = 0) {
  if (!playable()) return;
  const t = ctx.currentTime;
  const mag = Math.min(1, Math.abs(impactVelocity) / 26); // MAX_FALL_SPEED
  const peak = 0.18 + mag * 0.32;
  const dur = 0.14 + mag * 0.12;

  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150 + mag * 60, t);
  osc.frequency.exponentialRampToValueAtTime(48, t + dur);
  envelope(g, t, 0.005, peak, dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);

  // Soft transient click for the contact edge
  const click = ctx.createOscillator();
  const cg = ctx.createGain();
  click.type = 'triangle';
  click.frequency.setValueAtTime(220, t);
  envelope(cg, t, 0.002, 0.08 + mag * 0.1, 0.05);
  click.connect(cg); cg.connect(master);
  click.start(t); click.stop(t + 0.08);
}

// Combo chime — arpeggiated triad whose pitch tier rises with multiplier.
function combo(multiplier = 1) {
  if (!playable()) return;
  const t = ctx.currentTime;
  const notes = COMBO_NOTES[multiplier] || COMBO_NOTES[1];
  notes.forEach((freq, i) => {
    const start = t + i * 0.06;
    const dur = 0.25;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    envelope(g, start, 0.01, 0.16, dur);
    osc.connect(g); g.connect(master);
    osc.start(start); osc.stop(start + dur + 0.05);
  });
}

// Crash — white-noise burst plus a downward saw sweep for the wipeout.
function crash() {
  if (!playable()) return;
  const t = ctx.currentTime;
  const dur = 0.5;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3000, t);
  lp.frequency.exponentialRampToValueAtTime(300, t + dur);
  const ng = ctx.createGain();
  envelope(ng, t, 0.005, 0.4, dur);
  src.connect(lp); lp.connect(ng); ng.connect(master);
  src.start(t); src.stop(t + dur + 0.05);

  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + dur);
  envelope(g, t, 0.005, 0.3, dur);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// Milestone sting — bright two-note fanfare (perfect fifth) with quick decay.
function milestone() {
  if (!playable()) return;
  const t = ctx.currentTime;
  const pairs = [[783.99, 0], [1174.66, 0.08]]; // G5 then D6
  for (const [freq, off] of pairs) {
    const start = t + off;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, start);
    envelope(g, start, 0.01, 0.12, 0.4);
    osc.connect(g); g.connect(master);
    osc.start(start); osc.stop(start + 0.45);
  }
}

// Pickup — short bright upward blip.
function pickup() {
  if (!playable()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1760, t + 0.1);
  envelope(g, t, 0.005, 0.14, 0.1);
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + 0.16);
}

// ------------------------------------------------------------
// CONTROL
// ------------------------------------------------------------

function playable() {
  return ctx && !muted && ctx.state === 'running';
}

// Call from the first user input. Creates + resumes the context so subsequent
// SFX are audible (autoplay policy requires a gesture-driven resume).
function unlock() {
  ensureContext();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function setMuted(value) {
  muted = !!value;
  if (master) master.gain.value = muted ? 0 : MASTER_GAIN;
  return muted;
}

function isMuted() {
  return muted;
}

const audio = {
  unlock,
  boost,
  land,
  combo,
  crash,
  milestone,
  pickup,
  setMuted,
  isMuted,
};

export default audio;
