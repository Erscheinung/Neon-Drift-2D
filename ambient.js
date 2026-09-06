// ============================================================
// AMBIENT: crows + wind gusts for the skyline backdrop.
// ------------------------------------------------------------
// Two subtle, purely decorative sky accents drawn onto the skyline canvas.
// Both are darker/fainter than the neon city and stay in the upper sky so they
// never compete with gameplay in the central band. State is owned by the
// skyline module; these functions only mutate + draw it.
//   - Crows: occasional flocks of 1-4 silhouetted birds gliding across the top,
//     each with a sine-driven wing flap and a gentle bob.
//   - Wind: sparse curved air streaks that fade in/out, with periodic gusts that
//     briefly raise spawn rate + speed.
// ============================================================

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

// ── Crows ───────────────────────────────────────────────────────────────────
// Keep birds above the readability band: they spawn only in the upper sky.
const CROW_BAND_TOP = 0.06;   // fraction of viewH
const CROW_BAND_BOT = 0.34;

export function createAmbientState(viewW, viewH) {
  return {
    crows: [],
    nextFlockAt: rand(3, 7),      // seconds until first flock
    streaks: [],
    nextStreakAt: rand(0.4, 1.2),
    gustUntil: 0,                 // t while a gust is active
    nextGustAt: rand(12, 20),
  };
}

function spawnFlock(state, viewW, viewH, t) {
  const count = 1 + Math.floor(Math.random() * 4);
  const dir = Math.random() < 0.5 ? 1 : -1;           // fly right or left
  const baseY = rand(viewH * CROW_BAND_TOP, viewH * CROW_BAND_BOT);
  const speed = rand(55, 105) * dir;
  for (let i = 0; i < count; i++) {
    state.crows.push({
      startX: dir === 1 ? -80 : viewW + 80,
      baseY: baseY + rand(-22, 22),
      born: t + i * rand(0.12, 0.45),                  // staggered launch
      speed,
      dir,
      scale: rand(0.55, 1.15),
      phase: rand(0, TAU),
      flap: rand(7, 11),                               // wing beat rad/s
    });
  }
}

export function updateCrows(state, dt, t, viewW, viewH) {
  state.nextFlockAt -= dt;
  if (state.nextFlockAt <= 0) {
    spawnFlock(state, viewW, viewH, t);
    state.nextFlockAt = rand(9, 20);
  }
  // Cull birds fully offscreen (only after they've been born + travelled out).
  state.crows = state.crows.filter((c) => {
    const age = t - c.born;
    if (age < 0) return true;
    const x = c.startX + c.speed * age;
    return x > -100 && x < viewW + 100;
  });
}

function drawCrow(ctx, c, t) {
  const age = t - c.born;
  if (age < 0) return;
  const x = c.startX + c.speed * age;
  const y = c.baseY + Math.sin(age * 1.4 + c.phase) * 10;
  const rot = Math.sin(age * 1.2 + c.phase) * 0.06;

  // Wing flap: u in 0..1 raises the wing angle.
  const u = 0.5 + 0.5 * Math.sin(age * c.flap + c.phase);
  const a = -0.25 - u * 0.75;                          // wing angle, radians
  const wingLen = 13;
  const bodyW = 4;
  const bodyH = 3;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (c.dir < 0) ctx.scale(-1, 1);                     // face travel direction
  ctx.scale(c.scale, c.scale);

  const lx = -Math.cos(a) * wingLen;
  const ly = Math.sin(a) * wingLen;
  const rx = Math.cos(a) * wingLen;
  const ry = Math.sin(a) * wingLen;

  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.quadraticCurveTo(-12, -3 - u * 4, -bodyW, 1);
  ctx.quadraticCurveTo(0, bodyH, bodyW, 1);
  ctx.quadraticCurveTo(12, -3 - u * 4, rx, ry);
  ctx.quadraticCurveTo(7, 2, 0, -bodyH * 0.45);
  ctx.quadraticCurveTo(-7, 2, lx, ly);
  ctx.fillStyle = 'rgba(8,10,14,0.82)';
  ctx.fill();
  ctx.restore();
}

export function drawCrows(ctx, state, t) {
  for (const c of state.crows) drawCrow(ctx, c, t);
}

// ── Wind gusts ────────────────────────────────────────────────────────────────
// Faint curved streaks in the upper/mid sky. A gust briefly boosts spawn rate
// and speed so the air visibly "moves" for a couple seconds, then settles.
const STREAK_BAND_TOP = 0.08;
const STREAK_BAND_BOT = 0.45;
const STREAK_MAX = 14;

function spawnStreak(state, viewW, viewH, gusting) {
  const y = rand(viewH * STREAK_BAND_TOP, viewH * STREAK_BAND_BOT);
  const len = rand(40, 140) * (gusting ? 1.15 : 1);
  const speed = rand(25, 70) * (gusting ? 1.4 : 1);
  const life = rand(2, 5);
  const cyan = Math.random() < 0.6;
  state.streaks.push({
    x: -len,
    y,
    len,
    speed,
    width: rand(0.5, 1.2),
    wobble: rand(-6, 6),
    age: 0,
    life,
    peak: gusting ? rand(0.08, 0.11) : rand(0.035, 0.075),
    color: cyan ? '120,240,255' : '210,120,255',
  });
}

export function updateWind(state, dt, t, viewW, viewH) {
  // Trigger periodic gusts.
  state.nextGustAt -= dt;
  if (state.nextGustAt <= 0) {
    state.gustUntil = t + rand(2, 4);
    state.nextGustAt = rand(12, 20);
  }
  const gusting = t < state.gustUntil;

  state.nextStreakAt -= dt;
  if (state.nextStreakAt <= 0 && state.streaks.length < STREAK_MAX) {
    spawnStreak(state, viewW, viewH, gusting);
    state.nextStreakAt = gusting ? rand(0.15, 0.4) : rand(0.6, 1.6);
  }

  for (const s of state.streaks) {
    s.age += dt;
    s.x += s.speed * dt;
  }
  state.streaks = state.streaks.filter((s) => s.age < s.life && s.x < viewW + s.len);
}

export function drawWind(ctx, state) {
  for (const s of state.streaks) {
    const p = s.age / s.life;                          // 0..1 progress
    const alpha = s.peak * Math.sin(p * Math.PI);      // fade in + out
    if (alpha <= 0.002) continue;
    ctx.strokeStyle = `rgba(${s.color},${alpha})`;
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + s.len * 0.45, s.y + s.wobble, s.x + s.len, s.y + s.wobble * 0.4);
    ctx.stroke();
  }
}
