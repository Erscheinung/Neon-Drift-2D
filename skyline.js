// ============================================================
// SKYLINE: procedural neon-city backdrop, pure 2D canvas.
// ------------------------------------------------------------
// Renders a crisp animated cyberpunk skyline onto #skyline-canvas: a deep
// indigo sky with moon, clouds and stars; three parallax building layers
// (far / mid / near) of procedurally generated skyscrapers with lit window
// grids and neon roof edges; a rippling water reflection along the bottom;
// and a readability overlay dimming the vertical gameplay band. Self-contained:
// owns its canvas, its rAF loop, and all geometry (generated once, redrawn
// cheaply each frame). No three.js. Ambient — never reads game state.
// ============================================================

import { districtBlend } from './progression.mjs';

import {
  createAmbientState,
  updateCrows, drawCrows,
  updateWind, drawWind,
} from './ambient.js';

// --- Neon palette -------------------------------------------------------
const NEON = {
  cyan: '#00e5ff',
  magenta: '#ff2bd6',
  pink: '#ff4d8d',
  purple: '#9945ff',
  teal: '#00ffcc',
  amber: '#ffb020',
};

// Sky stops (top -> horizon) plus the magenta horizon glow band.
const SKY_TOP = '#0a0420';
const SKY_MID = '#2a0a3a';
const SKY_HORIZON = '#3a1050';
const HORIZON_GLOW = '#c0208a';

// Water occupies the bottom fraction of the viewport.
const WATER_FRACTION = 0.22;

// Layer configs, back-to-front. Each biases toward 1-2 hues so the city reads
// cohesive rather than rainbow. Nearer = taller, brighter, faster, more detail.
const LAYERS = [
  {
    name: 'far',
    speed: 6,           // px/sec scroll
    baseTop: 0.34,      // building tops start around this fraction of skyHeight
    heightRange: [0.18, 0.42],
    widthRange: [40, 90],
    gap: [6, 18],
    alpha: 0.42,
    saturation: 0.55,
    accents: [NEON.purple, NEON.magenta],
    windowChance: 0.42,
    windowSize: 3,
    detail: 0,
  },
  {
    name: 'mid',
    speed: 14,
    baseTop: 0.42,
    heightRange: [0.28, 0.58],
    widthRange: [55, 120],
    gap: [10, 26],
    alpha: 0.62,
    saturation: 0.8,
    accents: [NEON.cyan, NEON.purple],
    windowChance: 0.5,
    windowSize: 4,
    detail: 1,
  },
  {
    name: 'near',
    speed: 30,
    baseTop: 0.5,
    heightRange: [0.4, 0.78],
    widthRange: [80, 170],
    gap: [16, 40],
    alpha: 0.9,
    saturation: 1,
    accents: [NEON.cyan, NEON.magenta, NEON.amber],
    windowChance: 0.6,
    windowSize: 5,
    detail: 2,
  },
];

// --- Small deterministic-ish RNG helpers (used only at generation time) ---
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Desaturate toward the sky tone so far layers recede.
function desaturate(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const gray = 0.3 * r + 0.59 * g + 0.11 * b;
  const mix = (c) => Math.round(c + (gray - c) * (1 - amount));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ========================================================================
// Building generation. All randomness lives here so per-frame draw is stable.
// ========================================================================
function makeBuilding(cfg, x, skyHeight) {
  const w = randInt(cfg.widthRange[0], cfg.widthRange[1]);
  const h = skyHeight * rand(cfg.heightRange[0], cfg.heightRange[1]);
  const top = skyHeight - h;
  const accent = pick(cfg.accents);

  // Top shape: flat, stepped (a smaller box set on top), or antenna beacon.
  const shapeRoll = Math.random();
  const shape = shapeRoll < 0.5 ? 'flat' : shapeRoll < 0.8 ? 'stepped' : 'antenna';

  // Precompute the window grid once. Windows are a padded lattice of small
  // lit rects; each stores whether it's lit and a phase for occasional flicker.
  const winSize = cfg.windowSize;
  const gapPx = Math.max(2, Math.round(winSize * 0.8));
  const padX = Math.max(3, Math.round(w * 0.1));
  const padTop = Math.max(6, Math.round(winSize * 2));
  const cols = Math.max(0, Math.floor((w - padX * 2 + gapPx) / (winSize + gapPx)));
  const rows = Math.max(0, Math.floor((h - padTop + gapPx) / (winSize + gapPx)));
  const windows = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() > cfg.windowChance) continue;
      windows.push({
        dx: padX + c * (winSize + gapPx),
        dy: padTop + r * (winSize + gapPx),
        color: Math.random() < 0.7 ? accent : pick(cfg.accents),
        // ~12% of windows flicker; store a random phase + speed.
        flicker: Math.random() < 0.12,
        phase: Math.random() * Math.PI * 2,
        speed: rand(0.6, 2.2),
      });
    }
  }

  // Stepped roof: a narrower box stacked on top.
  let step = null;
  if (shape === 'stepped') {
    const sw = w * rand(0.4, 0.7);
    const sh = h * rand(0.12, 0.22);
    step = { w: sw, h: sh, dx: (w - sw) / 2 };
  }

  // Antenna: a thin mast with a beacon that pulses.
  let antenna = null;
  if (shape === 'antenna') {
    antenna = {
      dx: w * rand(0.4, 0.6),
      height: h * rand(0.12, 0.3),
      phase: Math.random() * Math.PI * 2,
    };
  }

  return { x, w, h, top, accent, shape, step, antenna, windows, winSize };
}

// Fill an infinite strip so it comfortably overflows the viewport (for wrap).
function generateLayer(cfg, viewW, skyHeight) {
  const buildings = [];
  let x = 0;
  const overflow = viewW + cfg.widthRange[1] * 2;
  while (x < overflow) {
    const b = makeBuilding(cfg, x, skyHeight);
    buildings.push(b);
    x += b.w + randInt(cfg.gap[0], cfg.gap[1]);
  }
  return { cfg, buildings, offset: 0, stripWidth: x };
}

// ========================================================================
// Sky elements (moon, clouds, stars) — generated once per resize.
// ========================================================================
function generateSky(viewW, viewH) {
  const stars = [];
  const starCount = Math.round((viewW * viewH) / 14000);
  for (let i = 0; i < starCount; i++) {
    stars.push({
      x: Math.random() * viewW,
      y: Math.random() * viewH * 0.5,
      r: rand(0.4, 1.3),
      phase: Math.random() * Math.PI * 2,
      speed: rand(0.4, 1.6),
    });
  }

  const clouds = [];
  const cloudCount = 4;
  for (let i = 0; i < cloudCount; i++) {
    clouds.push({
      x: Math.random() * viewW,
      y: rand(viewH * 0.06, viewH * 0.24),   // upper sky only — never over the play zone
      w: rand(viewW * 0.3, viewW * 0.7),
      h: rand(viewH * 0.035, viewH * 0.08),
      alpha: rand(0.03, 0.06),               // fainter so it never obscures gameplay
      color: Math.random() < 0.5 ? NEON.magenta : NEON.purple,
      speed: rand(2, 6),
    });
  }

  const moon = {
    x: viewW * rand(0.62, 0.82),
    y: viewH * rand(0.14, 0.26),
    r: Math.min(viewW, viewH) * rand(0.05, 0.08),
    drift: 0,
  };

  return { stars, clouds, moon };
}

// ========================================================================
// Main entry point.
// ========================================================================
export function initSkyline(getSeconds = () => 0) {
  const canvas = document.getElementById('skyline-canvas');
  if (!canvas) return;
  let ctx = canvas.getContext('2d');
  const output = ctx;
  let sceneBuffer;
  let districtLayers = [];
  let allLayers = [];
  let district = 0;
  if (!ctx) return;

  let dpr = 1;
  let viewW = 0;
  let viewH = 0;
  let skyHeight = 0;
  let waterTop = 0;
  let layers = [];
  let sky = null;
  let ambient = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    waterTop = viewH * (1 - WATER_FRACTION);
    skyHeight = waterTop; // buildings stand on the waterline
    // A is the original configuration, untouched. B/C inherit its same architecture grammar.
    districtLayers = [0, 1, 2].map(kind => LAYERS.map(cfg => generateLayer(kind === 0 ? cfg : {
      ...cfg,
      accents: kind === 1 ? [NEON.cyan, NEON.teal, NEON.purple] : [NEON.purple, NEON.magenta, NEON.amber],
      widthRange: cfg.widthRange.map(v => Math.round(v * (kind === 1 ? 1.2 : 1.4))),
      heightRange: cfg.heightRange.map(v => v * (kind === 1 ? .9 : 1.08)),
      gap: kind === 2 ? [10, 22] : cfg.gap,
    }, viewW, skyHeight)));
    allLayers = districtLayers.flat();
    layers = districtLayers[0];
    sceneBuffer = document.createElement('canvas');
    sceneBuffer.width = canvas.width; sceneBuffer.height = canvas.height;
    sky = generateSky(viewW, viewH);
    ambient = createAmbientState(viewW, viewH);
    // Warm bounded sprite caches at resize, never on a district transition.
    ctx = sceneBuffer.getContext('2d');
    for (district=1; district<3; district++) {
      for (const layer of districtLayers[district]) {
        for (const b of layer.buildings) drawBuilding(b, 0, layer.cfg, 0);
      }
    }
    district=0;ctx=output;
  }

  // --- Drawing routines -------------------------------------------------

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, skyHeight);
    g.addColorStop(0, district === 0 ? SKY_TOP : district === 1 ? '#030e20' : '#10051c');
    g.addColorStop(0.55, district === 0 ? SKY_MID : district === 1 ? '#132d42' : '#321034');
    g.addColorStop(1, district === 0 ? SKY_HORIZON : district === 1 ? '#285062' : '#512344');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, skyHeight);

    // Magenta horizon glow band just above the waterline.
    const bandH = skyHeight * 0.28;
    const hg = ctx.createLinearGradient(0, skyHeight - bandH, 0, skyHeight);
    hg.addColorStop(0, rgba(HORIZON_GLOW, 0));
    hg.addColorStop(1, rgba(HORIZON_GLOW, 0.5));
    ctx.fillStyle = hg;
    ctx.fillRect(0, skyHeight - bandH, viewW, bandH);
  }

  function drawStars(t) {
    for (const s of sky.stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
      ctx.globalAlpha = 0.2 + tw * 0.6;
      ctx.fillStyle = '#dfe8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  function drawMoon() {
    const m = sky.moon;
    const x = (m.x + m.drift) % (viewW + m.r * 2);
    const grd = ctx.createRadialGradient(x, m.y, 0, x, m.y, m.r * 2.4);
    grd.addColorStop(0, 'rgba(255,240,220,0.95)');
    grd.addColorStop(0.35, 'rgba(255,180,220,0.55)');
    grd.addColorStop(1, 'rgba(255,120,200,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, m.y, m.r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,245,235,0.95)';
    ctx.beginPath();
    ctx.arc(x, m.y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawClouds() {
    for (const c of sky.clouds) {
      const x = c.x % (viewW + c.w) - c.w * 0.5;
      const grd = ctx.createRadialGradient(x, c.y, 0, x, c.y, c.w * 0.5);
      grd.addColorStop(0, rgba(c.color, c.alpha));
      grd.addColorStop(1, rgba(c.color, 0));
      ctx.fillStyle = grd;
      ctx.save();
      ctx.translate(x, c.y);
      ctx.scale(1, c.h / (c.w * 0.5));
      ctx.beginPath();
      ctx.arc(0, 0, c.w * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Draw one building at an absolute x. Reused for both city + reflection
  // (reflection flips via ctx transform before calling).
  function drawBuildingBase(b, x, cfg, t) {
    const body = desaturate('#0d0518', cfg.saturation < 1 ? 0.6 : 0.85);
    // Silhouette body.
    ctx.fillStyle = body;
    ctx.fillRect(x, b.top, b.w, b.h);

    // Stepped roof box.
    if (b.step) {
      ctx.fillRect(x + b.step.dx, b.top - b.step.h, b.step.w, b.step.h);
    }

    // Neon roof edge (top) + one side edge in the accent color.
    const edge = desaturate(b.accent, cfg.saturation);
    ctx.strokeStyle = rgba(b.accent, cfg.alpha);
    ctx.lineWidth = cfg.detail >= 1 ? 2 : 1;
    ctx.shadowColor = edge;
    ctx.shadowBlur = cfg.detail >= 1 ? 8 : 3;
    ctx.beginPath();
    ctx.moveTo(x, b.top + b.h);
    ctx.lineTo(x, b.top);
    ctx.lineTo(x + b.w, b.top);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Windows.
    const size = b.winSize;
    for (const win of b.windows) {
      let a = cfg.alpha;
      if (win.flicker) {
        const f = Math.sin(t * win.speed + win.phase);
        if (f < -0.3) continue; // occasionally off
        a *= 0.55 + 0.45 * f;
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.fillStyle = win.color;
      ctx.fillRect(x + win.dx, b.top + win.dy, size, size);
    }
    ctx.globalAlpha = 1;

    // Antenna mast + pulsing beacon (near/mid only get the glow).
    if (b.antenna) {
      const ax = x + b.antenna.dx;
      const ayTop = b.top - b.antenna.height;
      ctx.strokeStyle = rgba(b.accent, cfg.alpha * 0.8);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, b.top);
      ctx.lineTo(ax, ayTop);
      ctx.stroke();
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + b.antenna.phase);
      ctx.fillStyle = rgba(NEON.pink, cfg.alpha * pulse);
      if (cfg.detail >= 1) {
        ctx.shadowColor = NEON.pink;
        ctx.shadowBlur = 6 * pulse;
      }
      ctx.beginPath();
      ctx.arc(ax, ayTop, cfg.detail >= 1 ? 2.5 : 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawBuilding(b, x, cfg, t) {
    if (district === 0) { drawBuildingBase(b, x, cfg, t); return; }
    // Bake windows, glow, facade ribs and roof infrastructure once per building.
    // The same sprite is reused in the reflected water pass.
    const pad = 64;
    if (!b.sprite) {
      b.sprite = document.createElement('canvas');
      b.spriteTop = Math.max(0, b.top - Math.max(b.step?.h || 0, b.antenna?.height || 0, 48) - 8);
      b.sprite.width = Math.ceil(b.w + pad * 2);
      b.sprite.height = Math.ceil(skyHeight - b.spriteTop + 8);
      const previous = ctx;
      ctx = b.sprite.getContext('2d'); ctx.translate(0,-b.spriteTop);
      drawBuildingBase(b, pad, cfg, 0);
      ctx.strokeStyle = rgba(b.accent, cfg.alpha * .65); ctx.lineWidth = 1;
      ctx.beginPath();
      if (district === 1) {
        // Rooftop station canopies and facade conduits; always rooted in architecture.
        const y = b.top - 12;
        ctx.moveTo(pad, b.top);ctx.lineTo(pad + 8,y);ctx.lineTo(pad+b.w-8,y);ctx.lineTo(pad+b.w,b.top);
        for(let i=1;i<5;i++) {const xx=pad+i*b.w/5;ctx.moveTo(xx,y);ctx.lineTo(xx,b.top);}
        for(let i=1;i<3;i++) {const xx=pad+i*b.w/3;ctx.moveTo(xx,b.top+8);ctx.lineTo(xx,b.top+b.h);}
      } else {
        // Heavy industrial roof vaults, turbine housings and segmented cooling fins.
        const r = Math.min(b.w*.32,38), cx=pad+b.w/2, cy=b.top;
        ctx.moveTo(cx+r,cy);ctx.arc(cx,cy,r,Math.PI,Math.PI*2);
        ctx.moveTo(cx+r-5,cy);ctx.arc(cx,cy,r-5,Math.PI,Math.PI*2);
        for(let yy=b.top+12;yy<b.top+b.h;yy+=24) {ctx.moveTo(pad+3,yy);ctx.lineTo(pad+b.w-3,yy);}
        ctx.moveTo(pad+b.w*.15,b.top);ctx.lineTo(pad+b.w*.15,b.top-26);ctx.lineTo(pad+b.w*.38,b.top-26);
      }
      ctx.stroke();ctx=previous;
    }
    ctx.drawImage(b.sprite,x-pad,b.spriteTop);
  }

  function drawInfrastructure(t) {
    if (district === 0) return;
    const mid=districtLayers[district][1];
    const y=skyHeight*(district === 1 ? .5 : .38);
    ctx.lineWidth=1;
    if(district === 1) {
      // Two continuous elevated lines with luminous carriage windows and slender pylons.
      for(let tier=0;tier<2;tier++) {
        const yy=y+tier*skyHeight*.17;
        ctx.fillStyle='#0a1224';ctx.fillRect(0,yy,viewW,9);
        ctx.strokeStyle='rgba(63,170,190,.35)';ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(viewW,yy);ctx.stroke();
        for(let x=-((mid.offset*1.3)%180);x<viewW;x+=180) {
          ctx.fillStyle='#12172b';ctx.fillRect(x,yy,5,skyHeight-yy);
          ctx.strokeStyle='rgba(83,116,166,.3)';ctx.beginPath();ctx.moveTo(x-40,yy);ctx.lineTo(x,yy+38);ctx.lineTo(x+40,yy);ctx.stroke();
        }
        const train=((t*(tier?-28:36))%(viewW+220)+viewW+220)%(viewW+220)-220;
        ctx.fillStyle='#17233b';ctx.fillRect(train,yy-13,145,11);
        ctx.fillStyle='rgba(99,224,232,.5)';for(let j=0;j<18;j++)ctx.fillRect(train+5+j*8,yy-10,4,3);
      }
    } else {
      for(let x=-(mid.offset%360);x<viewW+180;x+=360) {
        ctx.lineWidth=13;ctx.strokeStyle='#170e23';ctx.beginPath();ctx.moveTo(x-130,skyHeight);ctx.bezierCurveTo(x-130,skyHeight*.08,x+130,skyHeight*.08,x+130,skyHeight);ctx.stroke();
        ctx.lineWidth=1;ctx.strokeStyle='rgba(156,68,155,.35)';ctx.stroke();
        const cy=skyHeight*.38, r=45;
        ctx.fillStyle='#100c20';ctx.beginPath();ctx.arc(x,cy,r,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.strokeStyle='rgba(114,108,186,.45)';ctx.beginPath();
        for(let blade=0;blade<6;blade++){const a=t*.23+blade*Math.PI/3;ctx.moveTo(x+Math.cos(a)*8,cy+Math.sin(a)*8);ctx.lineTo(x+Math.cos(a+.3)*37,cy+Math.sin(a+.3)*37);}ctx.stroke();
      }
    }
  }

  // Draw a full parallax layer, wrapping buildings that scroll off the left.
  function drawLayer(layer, t) {
    const { cfg, buildings, stripWidth } = layer;
    ctx.globalAlpha = 1;
    for (const b of buildings) {
      // Wrap: shift by whole strip widths so x lands in the visible range.
      let x = b.x - layer.offset;
      x = ((x % stripWidth) + stripWidth) % stripWidth;
      if (x > viewW) x -= stripWidth; // allow buildings straddling left edge
      if (x + b.w < -cfg.widthRange[1] || x > viewW + cfg.widthRange[1]) continue;
      drawBuilding(b, x, cfg, t);
    }
    ctx.globalAlpha = 1;
  }

  // Water + reflection: mirror the near layer downward with wobble + scanlines.
  function drawWater(t) {
    // Base water gradient.
    const g = ctx.createLinearGradient(0, waterTop, 0, viewH);
    g.addColorStop(0, '#1a0630');
    g.addColorStop(1, '#050010');
    ctx.fillStyle = g;
    ctx.fillRect(0, waterTop, viewW, viewH * WATER_FRACTION);

    // Mirror the near layer into the water with a horizontal wobble.
    const near = layers[layers.length - 1];
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, waterTop, viewW, viewH - waterTop);
    ctx.clip();
    ctx.globalAlpha = 0.32;
    // Flip vertically about the waterline.
    ctx.translate(0, waterTop * 2);
    ctx.scale(1, -1);
    const wobble = Math.sin(t * 1.5) * 3;
    ctx.translate(wobble, 0);
    for (const b of near.buildings) {
      let x = b.x - near.offset;
      x = ((x % near.stripWidth) + near.stripWidth) % near.stripWidth;
      if (x > viewW) x -= near.stripWidth;
      if (x + b.w < 0 || x > viewW) continue;
      drawBuilding(b, x, near.cfg, t);
    }
    ctx.restore();

    // Horizontal scanline breaks over the reflection to sell the ripple.
    ctx.globalAlpha = 1;
    const lineGap = 4;
    ctx.fillStyle = 'rgba(5,0,16,0.35)';
    for (let y = waterTop; y < viewH; y += lineGap) {
      const off = Math.sin((y + t * 30) * 0.15) * 1;
      ctx.fillRect(0, y + off, viewW, 1.5);
    }

    // Magenta sheen along the waterline.
    const sheen = ctx.createLinearGradient(0, waterTop - 4, 0, waterTop + 10);
    sheen.addColorStop(0, rgba(HORIZON_GLOW, 0.4));
    sheen.addColorStop(1, rgba(HORIZON_GLOW, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(0, waterTop - 4, viewW, 14);
  }

  // Readability overlay: darken the vertical middle band where the bike flies,
  // and apply an overall dim so neon foreground pops.
  function drawOverlay() {
    const g = ctx.createLinearGradient(0, 0, 0, viewH);
    g.addColorStop(0, 'rgba(5,0,16,0.28)');
    g.addColorStop(0.35, 'rgba(5,0,16,0.5)');
    g.addColorStop(0.65, 'rgba(5,0,16,0.5)');
    g.addColorStop(1, 'rgba(5,0,16,0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  // --- Animation loop ---------------------------------------------------
  let last = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; }
    // The decorative backdrop needs only 30 fps; reserve time for game input
    // and foreground physics, which still update on every animation frame.
    if (now - last < 1000 / 30) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1; // clamp after tab-switch / stalls
    const t = now / 1000;

    // Advance scroll + drift.
    for (const layer of allLayers) {
      layer.offset = (layer.offset + layer.cfg.speed * dt) % layer.stripWidth;
    }
    sky.moon.drift += dt * 1.5;
    for (const c of sky.clouds) c.x += c.speed * dt;
    updateCrows(ambient, dt, t, viewW, viewH);
    updateWind(ambient, dt, t, viewW, viewH);

    const {weights}=districtBlend(getSeconds());
    output.clearRect(0,0,viewW,viewH);
    for(district=0;district<3;district++) {
      if(weights[district] === 0) continue;
      layers=districtLayers[district];
      ctx=sceneBuffer.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,viewW,viewH);
      drawSky();drawStars(t);drawMoon();drawClouds();
      drawWind(ctx,ambient);drawCrows(ctx,ambient,t);
      for(const layer of layers) drawLayer(layer,t);
      drawInfrastructure(t);
      drawWater(t);drawOverlay();
      output.globalCompositeOperation='lighter';output.globalAlpha=weights[district];
      output.drawImage(sceneBuffer,0,0,viewW,viewH);
    }
    output.globalAlpha=1;output.globalCompositeOperation='source-over';ctx=output;

  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
}
