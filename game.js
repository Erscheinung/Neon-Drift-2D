import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import audio from './audio.js';
import { showLeaderboard, closeLeaderboard, fetchGlobalBest, setLeaderboardPlayAgainHandler, getPlayerName, setPlayerName } from './highscore.js';
import { initSkyline } from './skyline.js';
import { createRun, tickRun, recordLanding, districtBlend, DISTRICTS } from './progression.mjs';
import { createDistricts } from './districts.js';
const drawDistricts = createDistricts();
let run = createRun();
let riderRecord = 0;
try { riderRecord = Number(localStorage.getItem('neondrift_rider_seconds')) || 0; } catch {}

// ============================================================
// SECTION 1: CONSTANTS & CONFIG
// ============================================================

const BIKE_SCREEN_X    = -3;
const GRAVITY          = -32;
const BOOST_IMPULSE    = 12.5;
const BOOST_FORWARD    = 4.5;   // forward kick added to scroll on boost
const BOOST_FUEL_COST  = 0.34;  // fuel drained per boost (>=3 boosts on a full tank)
const BOOST_FUEL_LAND  = 0.34;  // fuel refilled on a clean landing
const BOOST_FUEL_REGEN = 0.12;  // passive fuel/sec while grounded
const GLIDE_GRAVITY    = -8.5;  // reduced gravity while holding (glide/lift)
const DIVE_GRAVITY     = -58;   // extra pull when diving (released after apex, falling)
const MAX_FALL_SPEED   = -32;
const MAX_RISE_SPEED   = 17;
const COYOTE_TIME      = 0.11;  // grace window to boost after leaving ground
const INITIAL_SCROLL   = 8;
const SCROLL_ACCEL     = 0.05;  // per-second speed gain (aggressive ramp)
const SCROLL_MAX       = 30;
const FORWARD_DECAY    = 2.5;   // how fast the boost-forward bonus bleeds off
const PLATFORM_Y_MIN   = -1;
const PLATFORM_Y_MAX   = 2.5;
const GAP_MIN          = 1.8;
const GAP_MAX          = 5.5;
const PLATFORM_W_MIN   = 2.4;
const PLATFORM_W_MAX   = 8;
const POOL_SIZE        = 24;
const TRAIL_COUNT      = 800;
const BURST_COUNT      = 90;
const THRUST_COUNT     = 40;
const COMBO_TIMEOUT    = 3;
const COLOR_PHASE_DUR  = 30;
const CAMERA_LAG       = 6;
const BIKE_HW          = 0.5;
const BIKE_HH          = 0.3;
const MIN_DEATH_Y      = -5;
const BASE_FOV         = 72;

const SHARD_POOL_SIZE  = 10;
const SHARD_VALUE      = 250;   // base points per shard, scaled by score.multiplier
const SHARD_HW         = 0.55;  // half-extents for pickup AABB
const SHARD_HH         = 0.55;
const SHARD_SPIN       = 2.4;   // rad/s
const SHARD_BOB_AMP    = 0.18;
const SHARD_BOB_SPEED  = 2.2;

const COLOR_PHASES = [
  { zone: 'PRECISION SKYLINE', sky: new THREE.Color(0x050010), spireLine: new THREE.Color(0x6600cc), platformLine: new THREE.Color(0x9945ff), fogColor: new THREE.Color(0x330066), bikeColor: new THREE.Color(0x00ffff) },
  { zone: 'STORMLINE TRANSIT',  sky: new THREE.Color(0x001515), spireLine: new THREE.Color(0x00cccc), platformLine: new THREE.Color(0x00ffcc), fogColor: new THREE.Color(0x003333), bikeColor: new THREE.Color(0x00ffcc) },
  { zone: 'REACTOR CANOPY', sky: new THREE.Color(0x150010), spireLine: new THREE.Color(0xcc00cc), platformLine: new THREE.Color(0xff00cc), fogColor: new THREE.Color(0x330033), bikeColor: new THREE.Color(0xff00cc) },
];

// Distance (m) between color-phase advances; palette tracks progress. The 30s
// timer in COLOR_PHASE_DUR remains a fallback if the player stalls.
const ZONE_DISTANCE    = 700;
const DRONE_W          = 0.7;
const DRONE_H          = 0.5;
const LASER_W          = 0.15;
const LASER_H          = 3;
const TRACK_CLAMP      = 1.6;   // max +/- Y a tracking drone drifts from its base
const TRACK_EASE       = 1.8;   // ease rate toward bike Y
const TRACK_RANGE      = 6;     // only tracks when this close to bike in X
const SWEEP_ARC        = 0.7;   // radians of half-swing for a sweeping laser

// ============================================================
// SECTION 2: THREE.JS SETUP
// ============================================================

const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x050010, 0); // transparent: CSS skyline shows through

const scene  = new THREE.Scene();
scene.fog    = new THREE.FogExp2(0x050010, 0.04);

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3, 10);
const cameraBase = { x: 0, y: 3, z: 10 };

const ambientLight = new THREE.AmbientLight(0x111133, 1);
scene.add(ambientLight);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// SECTION 3: SHADER DEFINITIONS
// ============================================================

function makeGlowMaterial(color, opacity = 0.6) {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(color) },
      opacity:   { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        float d = distance(vUv, vec2(0.5));
        float alpha = (1.0 - smoothstep(0.0, 0.5, d)) * opacity;
        gl_FragColor = vec4(glowColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function makeFogMaterial(color, opacity = 0.12) {
  return new THREE.ShaderMaterial({
    uniforms: {
      fogColor: { value: new THREE.Color(color) },
      opacity:  { value: opacity },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 fogColor;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        float alpha = (1.0 - abs(vUv.x - 0.5) * 2.0) * (1.0 - abs(vUv.y - 0.5) * 1.5) * opacity;
        gl_FragColor = vec4(fogColor, clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// Soft round sprite for point particles. Kills the default square-quad look so
// bursts read as glowing sparks/embers rather than pixel blocks.
function makeSoftDotTexture() {
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0,   'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}
const softDotTexture = makeSoftDotTexture();

// ============================================================
// SECTION 4: ASSET CREATION (procedural geometry builders)
// ============================================================

function buildBike() {
  const group = new THREE.Group();

  // Body — elongated hexagon wireframe
  const bodyVerts = new Float32Array([
    -0.8, 0,     0,   -0.5, 0.3,  0,
    -0.5, 0.3,   0,    0.5, 0.3,  0,
     0.5, 0.3,   0,    0.8, 0,    0,
     0.8, 0,     0,    0.5,-0.3,  0,
     0.5,-0.3,   0,   -0.5,-0.3,  0,
    -0.5,-0.3,   0,   -0.8, 0,    0,
  ]);
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(bodyVerts, 3));
  const bodyMat = new THREE.LineBasicMaterial({ color: 0x00ffff });
  group.add(new THREE.LineLoop(bodyGeo, bodyMat));

  // Cockpit line
  const cockpitVerts = new Float32Array([0.3, 0.3, 0,  0.6, 0, 0,  0.3, -0.3, 0]);
  const cockpitGeo = new THREE.BufferGeometry();
  cockpitGeo.setAttribute('position', new THREE.BufferAttribute(cockpitVerts, 3));
  group.add(new THREE.Line(cockpitGeo, new THREE.LineBasicMaterial({ color: 0x9945ff })));

  // Interior detail lines — chassis struts + a seat/spine line give the body
  // structure so it reads as a vehicle, not a blank hexagon, and helps it pop.
  const detailVerts = new Float32Array([
    -0.5, 0.3, 0,   -0.2, -0.3, 0,   // front strut
     0.2, 0.3, 0,    0.5, -0.3, 0,   // rear strut
    -0.5, 0,   0,    0.5, 0,   0,   // spine
    -0.2, 0.15, 0,   0.2, 0.15, 0,  // dash line
  ]);
  const detailGeo = new THREE.BufferGeometry();
  detailGeo.setAttribute('position', new THREE.BufferAttribute(detailVerts, 3));
  const detailMat = new THREE.LineBasicMaterial({ color: 0x66faff, transparent: true, opacity: 0.85 });
  group.add(new THREE.LineSegments(detailGeo, detailMat));

  // White-hot core outline drawn on top of the body for a crisp bright edge.
  const coreMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
  const coreLoop = new THREE.LineLoop(bodyGeo, coreMat);
  coreLoop.scale.set(0.9, 0.9, 1);
  group.add(coreLoop);

  // Fine segmented panels and vector vanes stay within the established silhouette.
  const panelGeo = new THREE.BufferGeometry();
  panelGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -.65,.08,.02, -.35,.21,.02, -.35,.21,.02, -.12,.21,.02,
    -.12,.21,.02, -.05,.08,.02, .12,.24,.02, .35,.24,.02,
    -.65,-.08,.02, -.42,-.2,.02, .4,-.12,.02, .65,-.05,.02,
  ], 3));
  group.add(new THREE.LineSegments(panelGeo, new THREE.LineBasicMaterial({color: 0x87d6ff, transparent:true, opacity:.65})));

  // Wheels
  for (const [x, y] of [[-0.4, -0.3], [0.4, -0.3]]) {
    const ring = new THREE.RingGeometry(0.18, 0.22, 12);
    const wheelMesh = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 13 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0);
        })
      ),
      new THREE.LineBasicMaterial({ color: 0x00ffff })
    );
    wheelMesh.position.set(x, y, 0);
    group.add(wheelMesh);

    // Wheel glow
    const glowGeo = new THREE.PlaneGeometry(0.6, 0.6);
    const glowMesh = new THREE.Mesh(glowGeo, makeGlowMaterial(0x00ffff, 0.7));
    glowMesh.position.set(x, y, -0.1);
    group.add(glowMesh);
  }

  // Exhaust glow
  const exhaustGeo = new THREE.PlaneGeometry(0.4, 0.3);
  const exhaustMesh = new THREE.Mesh(exhaustGeo, makeGlowMaterial(0x9945ff, 0.7));
  exhaustMesh.position.set(-0.9, -0.1, 0);
  group.add(exhaustMesh);

  // Ground glow beneath bike
  const groundGlowGeo = new THREE.PlaneGeometry(1.6, 0.5);
  const groundGlowMesh = new THREE.Mesh(groundGlowGeo, makeGlowMaterial(0x00ffff, 0.25));
  groundGlowMesh.position.set(0, -0.5, -0.1);
  group.add(groundGlowMesh);
  group.userData.groundGlow = groundGlowMesh;

  // Body halo: large soft additive glow behind the whole bike so it reads as a
  // bright neon object over any busy background.
  const haloGeo = new THREE.PlaneGeometry(2.6, 1.6);
  const haloMesh = new THREE.Mesh(haloGeo, makeGlowMaterial(0x00ffff, 0.55));
  haloMesh.position.set(0, 0, -0.15);
  group.add(haloMesh);

  // Second, slightly larger low-opacity body outline to thicken the read.
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xccffff, transparent: true, opacity: 0.45 });
  const outlineLoop = new THREE.LineLoop(bodyGeo, outlineMat);
  outlineLoop.scale.set(1.18, 1.18, 1);
  group.add(outlineLoop);

  group.userData.bikeLines = [
    group.children[0], // body
    group.children[1], // cockpit
    group.children[2], group.children[4], // wheels
  ];
  group.userData.bodyMat   = bodyMat;
  group.userData.exhaustMesh = exhaustMesh;
  return group;
}

function buildPlatform(width) {
  const group = new THREE.Group();
  const h = 0.4;
  const geo = new THREE.BoxGeometry(width, h, 0.8);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1a0838 });
  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  const edges = new THREE.EdgesGeometry(geo);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xb066ff });
  const edgeMesh = new THREE.LineSegments(edges, lineMat);
  group.add(edgeMesh);

  // Bright top rail: a glowing bar sitting on the surface so the walkable top
  // and its ends read clearly against the dark gaps.
  const railGeo = new THREE.PlaneGeometry(width, 0.16);
  const railMesh = new THREE.Mesh(railGeo, makeGlowMaterial(0x00e5ff, 0.95));
  railMesh.position.set(0, h / 2 + 0.02, 0.41);
  group.add(railMesh);

  // Top surface glow (soft wash across the deck)
  const topGlowGeo = new THREE.PlaneGeometry(width, 0.6);
  const topGlowMesh = new THREE.Mesh(topGlowGeo, makeGlowMaterial(0x9945ff, 0.55));
  topGlowMesh.position.set(0, h / 2 + 0.01, 0);
  topGlowMesh.rotation.x = -Math.PI / 2;
  group.add(topGlowMesh);

  // Glowing end caps mark where the platform stops and the gap begins.
  const capMats = [];
  for (const sign of [-1, 1]) {
    const capGeo = new THREE.PlaneGeometry(0.18, h + 0.3);
    const capMat = makeGlowMaterial(0x00e5ff, 0.9);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(sign * width / 2, 0, 0.42);
    cap.userData.endSign = sign;
    group.add(cap);
    capMats.push(capMat);
  }

  const ribs = [];
  for (let x = -width / 2 + .35; x < width / 2; x += .5) ribs.push(x, -.16, .42, x + .12, .08, .42);
  ribs.push(-width / 2, -.1, .43, width / 2, -.1, .43);
  const ribGeo = new THREE.BufferGeometry();
  ribGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribs, 3));
  group.add(new THREE.LineSegments(ribGeo, new THREE.LineBasicMaterial({ color: 0x7755bb, transparent: true, opacity: .6 })));
  group.userData.lineMat   = lineMat;
  group.userData.topGlow   = topGlowMesh.material;
  group.userData.railMat   = railMesh.material;
  group.userData.capMats   = capMats;
  return group;
}

// Reuse the pool's five-unit meshes; preserve cap thickness and exact deck bounds.
function resizePlatform(group, width) {
  const scale = width / 5;
  for (const child of group.children) {
    if (child.userData.endSign) child.position.x = child.userData.endSign * width / 2;
    else child.scale.x = scale;
  }
}

function buildShard() {
  const group = new THREE.Group();

  // Diamond core: two stacked cones sharing a base ring (octahedral silhouette).
  const coreGeo = new THREE.OctahedronGeometry(0.28, 0);
  const coreMesh = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
  group.add(coreMesh);

  const edges = new THREE.EdgesGeometry(coreGeo);
  group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xaaffff })));

  // Additive glow halo behind the crystal
  const glowGeo = new THREE.PlaneGeometry(0.9, 0.9);
  const glowMesh = new THREE.Mesh(glowGeo, makeGlowMaterial(0x00ffcc, 0.85));
  glowMesh.position.set(0, 0, -0.1);
  group.add(glowMesh);
  group.userData.core = coreMesh;

  return group;
}

function buildDrone(tracking = false) {
  const group = new THREE.Group();
  // Tracking drones read as a hotter, more menacing hue than plain patrols.
  const edgeCol = tracking ? 0xffcc00 : 0xff3300;
  const lensCol = tracking ? 0xffdd33 : 0xff6600;
  const geo = new THREE.BoxGeometry(0.6, 0.4, 0.4);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0d0005 }));
  group.add(mesh);
  const edges = new THREE.EdgesGeometry(geo);
  group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: edgeCol })));

  // Lens
  const lensGeo = new THREE.PlaneGeometry(0.25, 0.25);
  const lensMesh = new THREE.Mesh(lensGeo, makeGlowMaterial(lensCol, 0.9));
  lensMesh.position.set(0, 0, 0.21);
  group.add(lensMesh);

  // Beam (scaleable vertically downward)
  const beamGeo = new THREE.PlaneGeometry(0.08, 1);
  const beamMesh = new THREE.Mesh(beamGeo, makeGlowMaterial(0xff3300, 0.4));
  beamMesh.position.set(0, -0.7, 0);
  group.userData.beam = beamMesh;
  group.add(beamMesh);

  return group;
}

function buildLaserWall(gapHeight, sweeping = false) {
  const group = new THREE.Group();
  const beamGeo = new THREE.PlaneGeometry(0.1, gapHeight);
  const beamMat = makeGlowMaterial(sweeping ? 0xff33aa : 0xff0033, 0.9);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  group.add(beam);

  // Emitter boxes top/bottom
  for (const sign of [-1, 1]) {
    const emGeo = new THREE.BoxGeometry(0.25, 0.2, 0.2);
    const em = new THREE.Mesh(emGeo, new THREE.MeshBasicMaterial({ color: 0x330010 }));
    em.position.set(0, sign * gapHeight / 2, 0);
    group.add(em);
    const emEdge = new THREE.EdgesGeometry(emGeo);
    group.add(new THREE.LineSegments(emEdge, new THREE.LineBasicMaterial({ color: 0xff0033 })));
  }

  group.userData.beamMat = beamMat;
  return group;
}

// ============================================================
// SECTION 5: WORLD STATE & OBJECT POOLS
// ============================================================

const backgroundGroup = new THREE.Group();
const midgroundGroup  = new THREE.Group();
const worldGroup      = new THREE.Group();
const bikeGroup       = buildBike();

backgroundGroup.position.z = -15;
midgroundGroup.position.z  = -5;

scene.add(backgroundGroup);
scene.add(midgroundGroup);
scene.add(worldGroup);
scene.add(bikeGroup);

bikeGroup.position.x = BIKE_SCREEN_X;

// Platform pool
const platformPool   = [];
const activePlatforms = [];
let   spawnCursorX   = 8;
let   lastPlatformY  = 1;
let   scrollSpeed    = INITIAL_SCROLL;
let   totalDistance  = 0;

for (let i = 0; i < POOL_SIZE; i++) {
  const plat = {
    group: buildPlatform(5),
    x: 0, y: 0, width: 5,
    active: false,
    surfaceY: 0,
  };
  plat.group.visible = false;
  worldGroup.add(plat.group);
  platformPool.push(plat);
}

// Obstacle pool. Four variants across two base types: patrol/tracking drones
// and blink/sweep lasers. Dimensions come from pooled consts (former known
// debt: w/h were hardcoded here and re-set again in spawnObstacle).
const obstaclePool   = [];
const activeObstacles = [];

// [type, variant] mix: 2 patrol drones, 2 tracking drones, 2 blink lasers, 2 sweep lasers.
const OBSTACLE_KINDS = [
  ['drone', 'patrol'], ['drone', 'patrol'],
  ['drone', 'track'],  ['drone', 'track'],
  ['laser', 'blink'],  ['laser', 'blink'],
  ['laser', 'sweep'],  ['laser', 'sweep'],
];

for (const [type, variant] of OBSTACLE_KINDS) {
  const isDrone = type === 'drone';
  const obj = {
    group:    isDrone ? buildDrone(variant === 'track') : buildLaserWall(LASER_H, variant === 'sweep'),
    type,
    variant,
    x: 0, y: 0,
    w: isDrone ? DRONE_W : LASER_W,
    h: isDrone ? DRONE_H : LASER_H,
    active:   false,
    baseY:    0,
    phaseOffset: Math.random() * Math.PI * 2,
    blinkTimer:  0,
    blinkOn:     true,
    sweepAngle:  0,
  };
  obj.group.visible = false;
  worldGroup.add(obj.group);
  obstaclePool.push(obj);
}

// Shard pool (collectible data shards)
const shardPool   = [];
const activeShards = [];

for (let i = 0; i < SHARD_POOL_SIZE; i++) {
  const shard = {
    group: buildShard(),
    x: 0, y: 0,
    baseY: 0,
    phaseOffset: Math.random() * Math.PI * 2,
    active: false,
  };
  shard.group.visible = false;
  worldGroup.add(shard.group);
  shardPool.push(shard);
}

// ============================================================
// SECTION 6: PARALLAX BACKGROUND SETUP
// ============================================================

// City skyline is a CSS backdrop (see index.html + skyline.js) rendered behind
// the transparent canvas. Kick off its crossfade cycle.
initSkyline();

// Mid fog strips
const fogStrips = [];
for (let i = 0; i < 5; i++) {
  const fogGeo = new THREE.PlaneGeometry(30, 0.8 + Math.random() * 0.6);
  const fogMesh = new THREE.Mesh(fogGeo, makeFogMaterial(0x330066, 0.1 + Math.random() * 0.08));
  fogMesh.position.set((i / 5) * 40 - 20, -1 + Math.random() * 3, 0);
  midgroundGroup.add(fogMesh);
  fogStrips.push({ mesh: fogMesh, baseX: fogMesh.position.x });
}

// ============================================================
// SECTION 7: PHYSICS & INPUT
// ============================================================

const physics = {
  y: 1.5,
  vy: 0,
  prevY: 1.5,         // Y at start of frame; used for swept landing (anti-tunnel)
  isGrounded: false,
  coyote: 0,          // time since left ground; boost allowed while < COYOTE_TIME
  airTime: 0,         // time spent airborne this jump
  flipAngle: 0,
  flipCount: 0,
  forwardBonus: 0,    // decaying horizontal speed kick from a boost
  boostFuel: 1,       // 0..1 stamina; boost gated on > 0, refills on clean landing
  _landedThisFrame: false,
  _landImpact: 0,
};

const input = {
  held: false,
  justPressed: false,
  justReleased: false,
};

window.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) pressGameControl(e); // start audio inside the user gesture
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    input.held = false;
    input.justReleased = true;
  }
});

// iOS Safari has had different Pointer Events support across versions and
// embedded browsers.  Bind one input path per browser, with a touch fallback,
// rather than relying on pointer events alone.  `touch-action: none` in CSS
// also makes this a game gesture instead of a browser zoom/scroll gesture.
function pressGameControl(event) {
  event.preventDefault();
  // Only capture on the canvas: launch overlays are hidden during this press.
  if (event.pointerId != null && event.currentTarget === canvas) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  input.justPressed = true;
  input.held = true;

  // The launch screens sit above the canvas, so their press must be able to
  // start a game immediately instead of waiting for a later synthetic event.
  if (gamePhase === 'IDLE' || (gamePhase === 'DEAD' && deathLockout <= 0)) {
    startGame();
  }
}

function releaseGameControl(event) {
  input.held = false;
  input.justReleased = true;
}

function bindGameControls(element) {
  element.addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
  });
  if (window.PointerEvent) {
    element.addEventListener('pointerdown', pressGameControl, { passive: false });
    element.addEventListener('pointerup', releaseGameControl, { passive: false });
    element.addEventListener('pointercancel', releaseGameControl, { passive: false });
  } else {
    element.addEventListener('touchstart', pressGameControl, { passive: false });
    element.addEventListener('touchend', releaseGameControl, { passive: false });
    element.addEventListener('touchcancel', releaseGameControl, { passive: false });
    element.addEventListener('mousedown', pressGameControl);
    window.addEventListener('mouseup', releaseGameControl);
  }
}

bindGameControls(canvas);

// Releases can land outside the canvas or on an overlay that was just hidden.
window.addEventListener('pointerup', releaseGameControl);
window.addEventListener('pointercancel', releaseGameControl);
window.addEventListener('touchend', releaseGameControl, { passive: false });
window.addEventListener('touchcancel', releaseGameControl, { passive: false });
canvas.addEventListener('lostpointercapture', releaseGameControl);
window.addEventListener('blur', () => {
  input.held = false;
  consumeInput();
});

function consumeInput() {
  input.justPressed  = false;
  input.justReleased = false;
}

function updatePhysics(delta) {
  physics.prevY = physics.y; // remember pre-integration Y for swept landing test
  // Choose gravity by input state: hold = glide (float), otherwise gravity;
  // once past apex with no hold, dive harder for tight-gap control.
  let g;
  if (physics.isGrounded) {
    g = GRAVITY;
    // Slow passive regen keeps the meter topped up between hops.
    if (physics.boostFuel < 1) {
      physics.boostFuel = Math.min(1, physics.boostFuel + BOOST_FUEL_REGEN * delta);
    }
  } else if (input.held) {
    g = GLIDE_GRAVITY;
  } else if (physics.vy < 0) {
    g = DIVE_GRAVITY;
  } else {
    g = GRAVITY;
  }

  physics.vy += g * delta;
  physics.vy = Math.max(physics.vy, MAX_FALL_SPEED);
  physics.vy = Math.min(physics.vy, MAX_RISE_SPEED);
  physics.y += physics.vy * delta;

  // Forward boost bonus decays back toward 0
  if (physics.forwardBonus > 0) {
    physics.forwardBonus = Math.max(0, physics.forwardBonus - FORWARD_DECAY * delta);
  }

  if (!physics.isGrounded) {
    physics.coyote += delta;
    physics.airTime += delta;
    // Flip only meaningfully when actually tumbling through air time
    physics.flipAngle += 3.2 * Math.PI * delta;
    if (physics.flipAngle >= 2 * Math.PI) {
      physics.flipAngle -= 2 * Math.PI;
      physics.flipCount++;
      showFlipIndicator(physics.flipCount);
    }
  }
}

// ============================================================
// SECTION 8: PROCEDURAL GENERATION
// ============================================================

function acquirePlatform() {
  const p = platformPool.pop();
  if (!p) return null;
  activePlatforms.push(p);
  p.active = true;
  p.group.visible = true;
  return p;
}

function releasePlatform(p) {
  p.active = false;
  p.group.visible = false;
  platformPool.push(p);
}

// Difficulty ramps aggressively so the run turns brutal fast. Returns 0 at the
// start, approaching 1 near ~650m.
function difficulty() {
  return Math.min(1, totalDistance / 650);
}

function spawnPlatform() {
  const d = difficulty();

  // Platform width: wide and forgiving early, brutally narrow as d rises.
  const wMax = PLATFORM_W_MAX - (PLATFORM_W_MAX - 3.4) * d;    // 8 -> 3.4
  const wMin = PLATFORM_W_MIN + (1 - d) * 2.6;                 // 5 -> 2.4
  const w = Math.max(PLATFORM_W_MIN, wMin + Math.random() * Math.max(0.8, wMax - wMin));

  // Height variation grows steeply with difficulty (small hops early, wild swings late).
  const heightSwing = 0.9 + d * 3.0;                          // 0.9 -> 3.9
  const dy = (Math.random() - 0.5) * heightSwing;
  lastPlatformY = Math.max(PLATFORM_Y_MIN, Math.min(PLATFORM_Y_MAX, lastPlatformY + dy));

  const p = acquirePlatform();
  if (!p) return;

  resizePlatform(p.group, w);

  p.width    = w;
  p.x        = spawnCursorX;
  p.y        = lastPlatformY;
  p.surfaceY = lastPlatformY + 0.2; // top of box (h=0.4, center at y)
  p.group.position.set(p.x + w / 2, p.y, 0);

  // Gap: opens quickly and reaches the full punishing range early.
  const gap = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN) * (0.35 + 0.65 * d);
  spawnCursorX += w + gap;

  // Data shards: reward risky arcs. Bias over the gap just opened (between this
  // platform's end and the next platform's start), sometimes arcing above the
  // deck. Rate scales lightly with difficulty: a few early, more mid-run.
  const shardChance = 0.35 + 0.4 * d;
  if (Math.random() < shardChance && shardPool.length > 0) {
    const gapStart = p.x + w;
    const overGap  = Math.random() < 0.65;
    let sx, sy;
    if (overGap) {
      sx = gapStart + gap * (0.3 + Math.random() * 0.4);
      sy = Math.max(p.y, lastPlatformY) + 1.4 + Math.random() * 1.2; // arc above the gap
    } else {
      sx = p.x + w * (0.3 + Math.random() * 0.4);
      sy = p.surfaceY + 1.0 + Math.random() * 1.0;
    }
    spawnShard(sx, sy);
  }

  // Obstacles arrive early and get dense. d=0.08 (~50m) onward, ramping hard.
  const obsChance = Math.max(0, (d - 0.08)) * 1.1; // starts ~50m, ramps to ~1.0
  if (w >= 3 && Math.random() < obsChance && obstaclePool.length > 0) {
    spawnObstacle(p);
  }
}

// Long safe runway under the bike so the player starts grounded, not falling.
function spawnStarter() {
  const w = 12;
  const p = acquirePlatform();
  if (!p) return 1;

  resizePlatform(p.group, w);

  const startY = 1;
  p.width    = w;
  p.x        = BIKE_SCREEN_X - 3; // extends behind and ahead of the bike
  p.y        = startY;
  p.surfaceY = startY + 0.2;
  p.group.position.set(p.x + w / 2, p.y, 0);

  lastPlatformY = startY;
  spawnCursorX  = p.x + w + GAP_MIN;
  return p.surfaceY;
}

// Pick a pooled obstacle. Difficulty biases toward the harder variants (tracking
// drones, sweeping lasers) as d rises, but keeps simple types available.
function pickObstacle(d) {
  const hardWeight = 0.15 + 0.75 * d;   // 0.15 -> 0.9 chance of the harder variant
  const wantHard   = Math.random() < hardWeight;
  const wantDrone  = Math.random() < 0.5;
  const type    = wantDrone ? 'drone' : 'laser';
  const variant = wantDrone ? (wantHard ? 'track' : 'patrol')
                            : (wantHard ? 'sweep' : 'blink');
  // Retire only the red patrol box; leave its slot empty rather than increasing other hazards.
  if (variant === 'patrol') return null;
  // Try exact match first, then any of the same base type, then anything left.
  let idx = obstaclePool.findIndex(o => o.type === type && o.variant === variant);
  if (idx < 0) idx = obstaclePool.findIndex(o => o.type === type && o.variant !== 'patrol');
  if (idx < 0) idx = obstaclePool.findIndex(o => o.variant !== 'patrol');
  if (idx < 0) return null;
  return obstaclePool.splice(idx, 1)[0];
}

function spawnObstacle(platform) {
  const obs = pickObstacle(difficulty());
  if (!obs) return;

  const useDrone = obs.type === 'drone';
  obs.active = true;
  obs.group.visible = true;
  obs.group.rotation.z = 0;
  obs.sweepAngle = 0;

  if (useDrone) {
    const ox = platform.x + platform.width * (0.3 + Math.random() * 0.4);
    const oy = platform.surfaceY + 1.2;
    obs.x = ox - 0.35;
    obs.y = oy - 0.25;
    obs.baseY = oy;
    obs.w = DRONE_W;
    obs.h = DRONE_H;
    obs.group.position.set(ox, oy, 0);
  } else {
    const ox = platform.x + platform.width * 0.5;
    const oy = platform.surfaceY + 1.5;
    obs.x = ox - LASER_W / 2;
    obs.y = oy - LASER_H / 2;
    obs.baseY = oy;
    obs.w = LASER_W;
    obs.h = LASER_H;
    obs.blinkTimer = 0;
    obs.blinkOn = true;
    obs.group.position.set(ox, oy, 0);
  }
  activeObstacles.push(obs);
}

function releaseObstacle(obs) {
  obs.active = false;
  obs.group.visible = false;
  obstaclePool.push(obs);
}

function spawnShard(x, y) {
  const shard = shardPool.pop();
  if (!shard) return;
  shard.active = true;
  shard.group.visible = true;
  shard.x = x;
  shard.y = y;
  shard.baseY = y;
  shard.group.position.set(x, y, 0);
  activeShards.push(shard);
}

function releaseShard(shard) {
  shard.active = false;
  shard.group.visible = false;
  shardPool.push(shard);
}

function updateWorld(delta) {
  scrollSpeed = Math.min(SCROLL_MAX, scrollSpeed + SCROLL_ACCEL * delta);
  const effSpeed = scrollSpeed + physics.forwardBonus;
  const move = effSpeed * delta;
  totalDistance += move;
  spawnCursorX -= move; // cursor rides the world so spawn-ahead keeps firing

  // Move platforms
  for (let i = activePlatforms.length - 1; i >= 0; i--) {
    const p = activePlatforms[i];
    p.x -= move;
    p.group.position.x = p.x + p.width / 2;
    if (p.x + p.width < -15) {
      activePlatforms.splice(i, 1);
      releasePlatform(p);
    }
  }

  // Move obstacles
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    const obs = activeObstacles[i];
    obs.x -= move;
    obs.baseY = obs.baseY; // stays on platform implicitly via position
    obs.group.position.x -= move;

    if (obs.type === 'drone') {
      const bob = obs.baseY + Math.sin(performance.now() / 1000 * 2 + obs.phaseOffset) * 0.3;
      if (obs.variant === 'track' && Math.abs(obs.group.position.x - BIKE_SCREEN_X) < TRACK_RANGE) {
        // Ease toward the bike's Y but clamp the drift around the bob height so
        // it stays menacing yet always dodgeable.
        const target = Math.max(bob - TRACK_CLAMP, Math.min(bob + TRACK_CLAMP, physics.y));
        obs.group.position.y += (target - obs.group.position.y) * TRACK_EASE * delta;
      } else {
        obs.group.position.y = bob;
      }
      obs.y = obs.group.position.y - DRONE_H / 2;
    } else if (obs.variant === 'sweep') {
      // Sweeping laser rotates through the gap instead of blinking.
      obs.sweepAngle = Math.sin(performance.now() / 1000 * 1.6 + obs.phaseOffset) * SWEEP_ARC;
      obs.group.rotation.z = obs.sweepAngle;
    } else {
      obs.blinkTimer += delta;
      if (obs.blinkTimer > 0.5) {
        obs.blinkTimer = 0;
        obs.blinkOn = !obs.blinkOn;
        obs.group.visible = obs.blinkOn;
        obs.active = obs.blinkOn;
      }
    }

    if (obs.group.position.x < -15) {
      activeObstacles.splice(i, 1);
      releaseObstacle(obs);
    }
  }

  // Move shards (ride the world, gentle bob + spin, recycle behind camera)
  for (let i = activeShards.length - 1; i >= 0; i--) {
    const shard = activeShards[i];
    shard.x -= move;
    shard.group.position.x = shard.x;
    shard.group.position.y = shard.baseY + Math.sin(performance.now() / 1000 * SHARD_BOB_SPEED + shard.phaseOffset) * SHARD_BOB_AMP;
    shard.y = shard.group.position.y;
    shard.group.rotation.y += SHARD_SPIN * delta;
    shard.group.rotation.z += SHARD_SPIN * 0.5 * delta;
    if (shard.x < -15) {
      activeShards.splice(i, 1);
      releaseShard(shard);
    }
  }

  // Spawn new platforms as needed
  while (spawnCursorX < 30) {
    spawnPlatform();
  }
}

// Initial terrain fill
for (let i = 0; i < POOL_SIZE - 2; i++) spawnPlatform();

// ============================================================
// SECTION 9: COLLISION DETECTION
// ============================================================

let pendingLandingFlips = 0;

function checkCollisions() {
  const bikeLeft   = BIKE_SCREEN_X - BIKE_HW;
  const bikeRight  = BIKE_SCREEN_X + BIKE_HW;
  const bikeBottom = physics.y - BIKE_HH;
  const bikeTop    = physics.y + BIKE_HH;

  physics.isGrounded = false;
  physics._landedThisFrame = false;
  for (const p of activePlatforms) {
    const platLeft  = p.x;
    const platRight = p.x + p.width;
    const platTop   = p.surfaceY;

    if (bikeRight > platLeft && bikeLeft < platRight) {
      // Swept landing test (anti-tunnel): at high fall speed a single frame can
      // move the bike from above the deck to well below it, skipping a narrow
      // static window. Land if descending and the bottom edge crossed platTop
      // this frame, or is resting within a small tolerance above it.
      const prevBottom = physics.prevY - BIKE_HH;
      const crossed    = prevBottom >= platTop - 0.05 && bikeBottom <= platTop + 0.1;
      const resting    = bikeBottom <= platTop + 0.1 && bikeBottom >= platTop - 0.6;
      if (physics.vy <= 0 && (crossed || resting)) {
        physics.y         = platTop + BIKE_HH;
        const impact      = physics.vy;
        physics.vy        = 0;
        physics.isGrounded = true;
        physics.coyote    = 0;
        physics.airTime   = 0;
        physics._landedThisFrame = true;
        physics._landImpact      = impact;
        refillBoostFuel(BOOST_FUEL_LAND);
        audio.land(impact);
        pendingLandingFlips = physics.flipCount;
        physics.flipCount = 0;
        physics.flipAngle = 0;
      }
    }
  }

  // Obstacle collision
  for (const obs of activeObstacles) {
    if (!obs.active) continue;
    const ox = obs.group.position.x;
    if (obs.variant === 'sweep') {
      // Swept laser: approximate the rotated beam as a tilted line pivoting at
      // its center (baseY). At the bike's Y offset from baseY the beam sits at
      // ox + tan(angle)*dyc; a hit needs the bike to overlap that X (widened for
      // beam thickness) while within the beam's vertical extent.
      const reach = Math.abs(Math.tan(obs.sweepAngle)) * (obs.h / 2) + obs.w / 2;
      const dyc   = physics.y - obs.baseY;
      const beamXAtBike = ox + Math.tan(obs.sweepAngle) * dyc;
      if (Math.abs(dyc) <= obs.h / 2 &&
          bikeRight > beamXAtBike - reach * 0.4 && bikeLeft < beamXAtBike + reach * 0.4) {
        triggerDeath();
        return;
      }
    } else if (bikeRight > ox - obs.w / 2 && bikeLeft < ox + obs.w / 2 &&
        bikeTop > obs.y && bikeBottom < obs.y + obs.h) {
      triggerDeath();
      return;
    }
  }

  // Shard pickup (AABB overlap vs bike)
  for (let i = activeShards.length - 1; i >= 0; i--) {
    const shard = activeShards[i];
    if (!shard.active) continue;
    if (bikeRight > shard.x - SHARD_HW && bikeLeft < shard.x + SHARD_HW &&
        bikeTop > shard.y - SHARD_HH && bikeBottom < shard.y + SHARD_HH) {
      score.points += SHARD_VALUE * score.multiplier;
      refillBoostFuel(BOOST_FUEL_LAND);
      audio.pickup();
      triggerBurst(0.4);
      activeShards.splice(i, 1);
      releaseShard(shard);
    }
  }

  // Fell off world
  if (physics.y < MIN_DEATH_Y) {
    triggerDeath();
  }
}

// ============================================================
// SECTION 10: COMBO & SCORE
// ============================================================

const score = {
  points: 0,
  distance: 0,
  multiplier: 1,
  combo: 0,
  comboTimer: 0,
  best: 0,
};

// Persisted best score (survives reload).
score.best = parseInt(localStorage.getItem('neondrift_best')) || 0;

// Reachable refill so collectible pickups (and clean landings) can top up fuel.
function refillBoostFuel(amount) {
  physics.boostFuel = Math.min(1, physics.boostFuel + amount);
}

function awardLandingCombo() {
  const flips = pendingLandingFlips;
  pendingLandingFlips = 0;
  if (physics._landedThisFrame && flips > 0) recordLanding(run, flips);
  else if (physics._landedThisFrame && physics._landImpact < -2) recordLanding(run, 0);
  if (flips <= 0) return;

  score.combo += flips;
  score.multiplier = flips >= 10 ? 5 : flips >= 6 ? 3 : flips >= 3 ? 2 : 1;
  score.points += flips * 100 * score.multiplier;
  score.comboTimer = COMBO_TIMEOUT;
  pulseCombo();
  audio.combo(score.multiplier);
}

function updateScore(delta) {
  score.distance += scrollSpeed * delta;
  score.points   += scrollSpeed * delta * 10;

  if (score.comboTimer > 0) {
    score.comboTimer -= delta;
    if (score.comboTimer <= 0) {
      score.combo      = 0;
      score.multiplier = 1;
    }
  }
}

function resetScore() {
  score.best       = Math.max(score.best, Math.floor(score.points));
  score.points     = 0;
  score.distance   = 0;
  score.multiplier = 1;
  score.combo      = 0;
  score.comboTimer = 0;
}

// ============================================================
// SECTION 11: PARTICLE SYSTEMS
// ============================================================

// Trail
const trailParticles = Array.from({ length: TRAIL_COUNT }, () => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, maxLife: 1, r: 0, g: 1, b: 1, active: false,
}));
const trailPositions = new Float32Array(TRAIL_COUNT * 3);
const trailColors    = new Float32Array(TRAIL_COUNT * 3);
const trailGeo  = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
trailGeo.setAttribute('color',    new THREE.BufferAttribute(trailColors, 3));
const trailMat  = new THREE.PointsMaterial({
  size: 0.23, map: softDotTexture, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});
const trailSystem = new THREE.Points(trailGeo, trailMat);
scene.add(trailSystem);

// Burst
const burstParticles = Array.from({ length: BURST_COUNT }, () => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, maxLife: 0.8, r: 0, g: 1, b: 1, active: false,
}));
const burstPositions = new Float32Array(BURST_COUNT * 3);
const burstColors    = new Float32Array(BURST_COUNT * 3);
const burstGeo  = new THREE.BufferGeometry();
burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPositions, 3));
burstGeo.setAttribute('color',    new THREE.BufferAttribute(burstColors, 3));
const burstMat  = new THREE.PointsMaterial({
  size: 0.5, map: softDotTexture, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});
const burstSystem = new THREE.Points(burstGeo, burstMat);
scene.add(burstSystem);

// Landing spark ring: a clean cyan shockwave fired on touchdown. Replaces the
// old magenta square burst so a clean landing reads as a crisp neon impact,
// not a pink blob. Particles fan outward in a low arc and fade fast.
const LANDING_COUNT = 44;
const landingParticles = Array.from({ length: LANDING_COUNT }, () => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, maxLife: 0.4, active: false,
}));
const landingPositions = new Float32Array(LANDING_COUNT * 3);
const landingColors    = new Float32Array(LANDING_COUNT * 3);
const landingGeo  = new THREE.BufferGeometry();
landingGeo.setAttribute('position', new THREE.BufferAttribute(landingPositions, 3));
landingGeo.setAttribute('color',    new THREE.BufferAttribute(landingColors, 3));
const landingMat  = new THREE.PointsMaterial({
  size: 0.42, map: softDotTexture, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});
const landingSystem = new THREE.Points(landingGeo, landingMat);
scene.add(landingSystem);

// impactScale ~0..1 controls spread and count intensity of the shockwave.
function triggerLandingSpark(impactScale = 0.5) {
  const s = 0.5 + impactScale * 1.4;
  let n = 0;
  for (const p of landingParticles) {
    // Fan outward mostly sideways/up, hugging the deck for a shockwave feel.
    const a = -Math.PI * 0.15 + Math.random() * Math.PI * 1.3; // biased upward arc
    const speed = (3 + Math.random() * 4) * s;
    p.active  = true;
    p.x       = BIKE_SCREEN_X;
    p.y       = physics.y - BIKE_HH + 0.05;
    p.z       = 0;
    p.vx      = Math.cos(a) * speed * (Math.random() < 0.5 ? -1 : 1);
    p.vy      = Math.abs(Math.sin(a)) * speed * 0.7;
    p.maxLife = 0.28 + Math.random() * 0.22;
    p.life    = p.maxLife;
    if (++n >= Math.ceil(LANDING_COUNT * (0.5 + impactScale * 0.5))) break;
  }
}

// Thrust (directional jet fired backward/down on boost)
const thrustParticles = Array.from({ length: THRUST_COUNT }, () => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, life: 0, maxLife: 0.4, active: false,
}));
const thrustPositions = new Float32Array(THRUST_COUNT * 3);
const thrustColors    = new Float32Array(THRUST_COUNT * 3);
const thrustGeo  = new THREE.BufferGeometry();
thrustGeo.setAttribute('position', new THREE.BufferAttribute(thrustPositions, 3));
thrustGeo.setAttribute('color',    new THREE.BufferAttribute(thrustColors, 3));
const thrustMat  = new THREE.PointsMaterial({
  size: 0.3, vertexColors: true, transparent: true,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});
const thrustSystem = new THREE.Points(thrustGeo, thrustMat);
scene.add(thrustSystem);

function emitThrust() {
  for (const p of thrustParticles) {
    if (!p.active) {
      p.active  = true;
      p.x       = BIKE_SCREEN_X - 0.7;
      p.y       = physics.y - 0.1;
      p.z       = 0;
      const spread = (Math.random() - 0.5) * 1.2;
      p.vx      = -4 - Math.random() * 4;
      p.vy      = spread - 2;
      p.maxLife = 0.25 + Math.random() * 0.25;
      p.life    = p.maxLife;
    }
  }
}

const TRAIL_PALETTE = [[0.02, 1, 1], [0.3, 0.45, 1], [0.65, 0.12, 1], [1, 0.04, 0.65]];
let trailHueIndex = 0;
function emitTrail() {
  const speedFactor = (scrollSpeed + physics.forwardBonus) / INITIAL_SCROLL;
  // World always scrolls (the bike is always running), so always shed a trail —
  // from the very first frame, before any input. Airborne/boosting sheds more.
  const active = true;
  if (!active) return;
  let count = 0;
  const emitPerFrame = !physics.isGrounded ? 5 : (physics.forwardBonus > 0.5 ? 4 : 2);
  for (const p of trailParticles) {
    if (!p.active && count < emitPerFrame) {
      p.active  = true;
      p.x       = BIKE_SCREEN_X - 0.7 - Math.random() * 0.3;
      p.y       = physics.y - 0.12 + (Math.random() - 0.5) * 0.18;
      p.z       = 0;
      const hue = TRAIL_PALETTE[Math.floor(trailHueIndex++ / 3) % TRAIL_PALETTE.length];
      [p.r, p.g, p.b] = hue;
      // Strong leftward velocity so particles stream behind and clear the frame
      // quickly rather than lingering as a cloud around the bike.
      p.vx      = -(6 + Math.random() * 4) * speedFactor;
      p.vy      = (Math.random() - 0.5) * 0.4;
      p.maxLife = 0.55 + Math.random() * 0.5;
      p.life    = p.maxLife;
      count++;
    }
  }
}

// Neon palette for dramatic death bursts. Each particle picks one and stores its
// r,g,b; pickups keep the modest fixed cyan/pink look.
const BURST_NEON = [
  [0.0, 1.0, 1.0],  // cyan
  [1.0, 0.0, 0.8],  // magenta
  [1.0, 0.2, 0.6],  // hot pink
  [0.6, 0.2, 1.0],  // purple
  [1.0, 1.0, 1.0],  // white-hot
];

function triggerBurst(scale = 1, opts = {}) {
  const deadly = opts.deadly === true;
  // Death gets a bigger, faster, longer-lived multi-color spread; pickups stay
  // small and subtle.
  const speedBase = deadly ? 5 : 2;
  const speedRand = deadly ? 11 : 5;
  const lifeMul   = deadly ? 1.6 : 1;
  for (const p of burstParticles) {
    p.active  = true;
    p.x       = BIKE_SCREEN_X;
    p.y       = physics.y;
    p.z       = 0;
    const angle = Math.random() * Math.PI * 2;
    const speed = (speedBase + Math.random() * speedRand) * scale;
    p.vx      = Math.cos(angle) * speed;
    p.vy      = Math.sin(angle) * speed;
    p.maxLife = (0.5 + Math.random() * 0.5) * scale * lifeMul;
    p.life    = p.maxLife;
    if (deadly) {
      const c = BURST_NEON[(Math.random() * BURST_NEON.length) | 0];
      p.r = c[0]; p.g = c[1]; p.b = c[2];
    } else {
      // Modest pickup look: cyan-to-pink, handled by the fallback color-write.
      p.r = -1; // sentinel: use legacy ramp
    }
  }
}

function updateParticles(delta) {
  // Trail
  let tIdx = 0;
  for (const p of trailParticles) {
    if (p.active) {
      p.x    += p.vx * delta;
      p.y    += p.vy * delta;
      p.life -= delta;
      if (p.life <= 0) p.active = false;
    }
    const t = p.active ? p.life / p.maxLife : 0;
    if (p.active) {
      trailPositions[tIdx]     = p.x;
      trailPositions[tIdx + 1] = p.y;
      trailPositions[tIdx + 2] = p.z;
    } else {
      // Park offscreen: a color-zero point still writes black alpha onto the
      // transparent canvas, punching a dark hole over the skyline. Move it away.
      trailPositions[tIdx]     = 0;
      trailPositions[tIdx + 1] = -9999;
      trailPositions[tIdx + 2] = 0;
    }
    // Saturated neon packets fade without bleaching into white squares.
    const fade = Math.sqrt(t);
    trailColors[tIdx]     = p.r * fade;
    trailColors[tIdx + 1] = p.g * fade;
    trailColors[tIdx + 2] = p.b * fade;
    tIdx += 3;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.color.needsUpdate    = true;

  // Burst
  let bIdx = 0;
  for (const p of burstParticles) {
    if (p.active) {
      p.x    += p.vx * delta;
      p.y    += p.vy * delta;
      p.vy   -= 8 * delta;
      p.life -= delta;
      if (p.life <= 0) p.active = false;
    }
    const t = p.active ? p.life / p.maxLife : 0;
    if (p.active) {
      burstPositions[bIdx]     = p.x;
      burstPositions[bIdx + 1] = p.y;
      burstPositions[bIdx + 2] = p.z;
    } else {
      burstPositions[bIdx]     = 0;
      burstPositions[bIdx + 1] = -9999;
      burstPositions[bIdx + 2] = 0;
    }
    if (p.r >= 0) {
      // Death particle: white-hot at spawn, easing to its stored neon hue as it
      // cools, then out. whiteMix is high early (t near 1) so the core flashes;
      // the t multiply fades the whole thing (and zeros inactive particles).
      const whiteMix = Math.max(0, (t - 0.6) / 0.4);
      burstColors[bIdx]     = (p.r + (1 - p.r) * whiteMix) * t;
      burstColors[bIdx + 1] = (p.g + (1 - p.g) * whiteMix) * t;
      burstColors[bIdx + 2] = (p.b + (1 - p.b) * whiteMix) * t;
    } else {
      // Pickup: legacy cyan-to-pink ramp, faded out by t so spent particles clear.
      burstColors[bIdx]     = t;
      burstColors[bIdx + 1] = t * t * 0.5;
      burstColors[bIdx + 2] = (1 - t) * t;
    }
    bIdx += 3;
  }
  burstGeo.attributes.position.needsUpdate = true;
  burstGeo.attributes.color.needsUpdate    = true;

  // Thrust jet
  let jIdx = 0;
  for (const p of thrustParticles) {
    if (p.active) {
      p.x    += p.vx * delta;
      p.y    += p.vy * delta;
      p.life -= delta;
      if (p.life <= 0) p.active = false;
    }
    const t = p.active ? p.life / p.maxLife : 0;
    if (p.active) {
      thrustPositions[jIdx]     = p.x;
      thrustPositions[jIdx + 1] = p.y;
      thrustPositions[jIdx + 2] = p.z;
    } else {
      thrustPositions[jIdx]     = 0;
      thrustPositions[jIdx + 1] = -9999;
      thrustPositions[jIdx + 2] = 0;
    }
    // hot core: white/yellow → magenta as it cools
    thrustColors[jIdx]     = t;
    thrustColors[jIdx + 1] = t * t * 0.8;
    thrustColors[jIdx + 2] = (0.4 + (1 - t) * 0.6) * t;
    jIdx += 3;
  }
  thrustGeo.attributes.position.needsUpdate = true;
  thrustGeo.attributes.color.needsUpdate    = true;

  // Landing shockwave: cyan core fading toward white as it expands.
  let lIdx = 0;
  for (const p of landingParticles) {
    if (p.active) {
      p.x    += p.vx * delta;
      p.y    += p.vy * delta;
      p.vy   -= 10 * delta; // gravity pulls the arc back down
      p.vx   *= 0.92;       // drag so the ring settles instead of flying off
      p.life -= delta;
      if (p.life <= 0) p.active = false;
    }
    const t = p.active ? p.life / p.maxLife : 0;
    if (p.active) {
      landingPositions[lIdx]     = p.x;
      landingPositions[lIdx + 1] = p.y;
      landingPositions[lIdx + 2] = p.z;
    } else {
      landingPositions[lIdx]     = 0;
      landingPositions[lIdx + 1] = -9999;
      landingPositions[lIdx + 2] = 0;
    }
    // bright cyan-white fresh, cooling to cyan
    landingColors[lIdx]     = (0.5 + t * 0.5) * t;
    landingColors[lIdx + 1] = t;
    landingColors[lIdx + 2] = t;
    lIdx += 3;
  }
  landingGeo.attributes.position.needsUpdate = true;
  landingGeo.attributes.color.needsUpdate    = true;
}

// ============================================================
// SECTION 12: VISUAL EFFECTS (shake, color cycle)
// ============================================================

const shake = { intensity: 0, decay: 8 };
const colorState = {
  phase: 0,
  t:     0,
};

function triggerShake(amount) {
  shake.intensity = Math.max(shake.intensity, amount);
}

function updateShake(delta) {
  if (shake.intensity > 0.001) {
    const ox = (Math.random() - 0.5) * shake.intensity;
    const oy = (Math.random() - 0.5) * shake.intensity;
    camera.position.x = cameraBase.x + ox;
    camera.position.y = cameraBase.y + oy;
    shake.intensity -= shake.decay * delta;
  } else {
    shake.intensity   = 0;
    camera.position.x = cameraBase.x;
    camera.position.y = cameraBase.y;
  }
}

const _colorA = new THREE.Color();
const _colorB = new THREE.Color();

function advanceZone() {
  colorState.phase = (colorState.phase + 1) % 3;
  colorState.t     = 0;
  // District identity follows active play time; distance banners remain separate.
}

function updateColorCycle(delta) {
  // Match foreground palette to the same seven-second district clock.
  const district = districtBlend(run.seconds);
  colorState.phase = district.phase;
  colorState.t = district.weights[(district.phase + 1) % 3];

  const phaseA = COLOR_PHASES[colorState.phase];
  const phaseB = COLOR_PHASES[(colorState.phase + 1) % 3];
  const t      = colorState.t;

  _colorA.copy(phaseA.sky).lerp(phaseB.sky, t);
  renderer.setClearColor(_colorA, 0); // keep transparent so CSS skyline shows
  scene.fog.color.copy(_colorA);

  const lineCol = _colorB.copy(phaseA.platformLine).lerp(phaseB.platformLine, t);
  for (const p of activePlatforms) {
    if (p.group.userData.lineMat) p.group.userData.lineMat.color.copy(lineCol);
  }

  const bikeCol = _colorA.copy(phaseA.bikeColor).lerp(phaseB.bikeColor, t);
  if (bikeGroup.userData.bodyMat) {
    bikeGroup.userData.bodyMat.color.copy(bikeCol);
  }
}

function updateParallax(delta) {
  const mgMove = scrollSpeed * 0.35 * delta;

  for (const f of fogStrips) {
    f.mesh.position.x -= mgMove;
    if (f.mesh.position.x < -20) f.mesh.position.x += 40;
  }
}

// ============================================================
// SECTION 13: UI UPDATE
// ============================================================

const elScore    = document.getElementById('score-value');
const elDist     = document.getElementById('dist-value');
const elMult     = document.getElementById('mult-value');
const elFuelBar  = document.getElementById('fuel-bar');
const elFuelFill = document.getElementById('fuel-fill');
const elFlip     = document.getElementById('flip-counter');
const elMilestone  = document.getElementById('milestone-banner');
const elDeathScore    = document.getElementById('death-score');
const elBestScore     = document.getElementById('best-score-label');
const elStartBest     = document.getElementById('start-best-label');
const elStartGlobal   = document.getElementById('start-global-label');
const elDeathGlobal   = document.getElementById('death-global-label');

function renderBest() {
  if (elStartBest) elStartBest.textContent = 'YOUR BEST: ' + score.best.toString().padStart(6, '0');
}
renderBest();

async function refreshGlobalBest() {
  const top = await fetchGlobalBest();
  const text = top ? `GLOBAL BEST: ${top.name} · ${top.score.toLocaleString()}` : '';
  if (elStartGlobal) elStartGlobal.textContent = text;
  if (elDeathGlobal) elDeathGlobal.textContent = text;
}
refreshGlobalBest();

const MILESTONE_STEP = 250;
let nextMilestone = MILESTONE_STEP;
let milestoneTimer = 0;
let nextZoneDist   = ZONE_DISTANCE;

function showZone(name) {
  elMilestone.textContent = 'ENTERING: ' + name;
  elMilestone.classList.add('show');
  milestoneTimer = 1.8;
  triggerShake(0.14);
}

function showMilestone(dist) {
  elMilestone.textContent = dist + 'M';
  elMilestone.classList.add('show');
  milestoneTimer = 1.4;
  triggerShake(0.1);
  audio.milestone();
}

function updateMilestone(delta) {
  if (score.distance >= nextMilestone) {
    showMilestone(nextMilestone);
    nextMilestone += MILESTONE_STEP;
  }
  if (milestoneTimer > 0) {
    milestoneTimer -= delta;
    if (milestoneTimer <= 0) elMilestone.classList.remove('show');
  }
}

let comboEl = document.getElementById('combo-display');

let lastHUDTime = -1;
function updateUI() {
  if (run.seconds >= lastHUDTime && run.seconds - lastHUDTime < .1) return;
  lastHUDTime = run.seconds;
  document.getElementById('run-time').textContent = `${Math.floor(run.seconds)}s • ${run.streak}/3 FLIP LANDINGS`;
  document.getElementById('district-name').textContent = DISTRICTS[districtBlend(run.seconds).phase];
  document.getElementById('run-message').textContent = run.messageTime > 0 ? run.message : (riderRecord ? `RIDER RECORD: ${riderRecord}s` : 'LAND 3 FLIP JUMPS IN A ROW');
  elScore.textContent = Math.floor(score.points).toString().padStart(6, '0');
  elDist.textContent  = Math.floor(score.distance) + 'm';
  elMult.textContent  = 'x' + score.multiplier;
  if (elFuelFill) {
    elFuelFill.style.width = (physics.boostFuel * 100) + '%';
    elFuelBar.classList.toggle('low', physics.boostFuel < BOOST_FUEL_COST);
  }
}

function pulseCombo() {
  comboEl.classList.remove('pulse');
  void comboEl.offsetWidth; // reflow
  comboEl.classList.add('pulse');
  setTimeout(() => comboEl.classList.remove('pulse'), 150);
}

let flipTimer = 0;
function showFlipIndicator(count) {
  elFlip.textContent = count > 1 ? count + 'x FLIP!' : 'FLIP!';
  elFlip.classList.add('show');
  flipTimer = 1;
}

function updateFlipIndicator(delta) {
  if (flipTimer > 0) {
    flipTimer -= delta;
    if (flipTimer <= 0) elFlip.classList.remove('show');
  }
}

// ============================================================
// SECTION 14: GAME STATE MACHINE
// ============================================================

let gamePhase = 'IDLE';
let deathLockout = 0;      // seconds remaining before restart input is accepted
let deathTimeout = null;   // handle to the death-screen reveal timer

const startScreen = document.getElementById('start-screen');
const deathScreen  = document.getElementById('death-screen');
const startNameInput = document.getElementById('start-name-input');

// Prefill saved name so returning players keep their identity.
if (startNameInput) startNameInput.value = getPlayerName();

// Typing in the name field must not start the game or trigger a boost.
if (startNameInput) {
  startNameInput.addEventListener('keydown', e => e.stopPropagation());
  for (const ev of ['pointerdown', 'touchstart', 'mousedown']) {
    startNameInput.addEventListener(ev, e => e.stopPropagation());
  }
}

// Screens capture input while visible, so they need the same Safari-safe
// controls as the canvas.
for (const el of [startScreen, deathScreen]) bindGameControls(el);

function startGame() {
  if (deathTimeout) { clearTimeout(deathTimeout); deathTimeout = null; }
  // Persist any name typed on the start screen before we hide it.
  if (startNameInput && startNameInput.value.trim()) {
    setPlayerName(startNameInput.value);
  }
  closeLeaderboard();
  audio.unlock();
  audio.playMusic();
  startScreen.style.display = 'none';
  deathScreen.style.display = 'none';
  deathLockout = 0;
  gamePhase = 'PLAYING';
  paused = document.hidden;
  resetWorld();
  resetScore();
  run = createRun();
  lastHUDTime = -1;
  updateUI();
  consumeInput();
  lastTime = performance.now();
}

// The score modal sits above the retry screen, so its Play Again button must
// restart the game directly instead of relying on a tap reaching the overlay.
setLeaderboardPlayAgainHandler(startGame);

function triggerDeath() {
  if (gamePhase !== 'PLAYING') return;
  gamePhase = 'DEAD';
  audio.pauseMusic();
  triggerShake(0.7);
  // Dramatic multi-color death explosion: big fast spread + white-hot flash.
  triggerBurst(1.8, { deadly: true });
  audio.crash();
  score.best = Math.max(score.best, Math.floor(score.points));
  localStorage.setItem('neondrift_best', score.best);
  renderBest();
  elDeathScore.textContent  = Math.floor(score.points).toString().padStart(6, '0');
  elBestScore.textContent   = 'YOUR BEST: ' + score.best.toString().padStart(6, '0');
  refreshGlobalBest();
  // Clear held so a still-pressed key from the fatal boost doesn't block the
  // next justPressed on retry.
  input.held = false;
  deathLockout = 0.5; // ignore restart taps until the screen is up
  const finalScore = Math.floor(score.points);
  deathTimeout = setTimeout(() => {
    deathScreen.style.display = 'flex';
    if (finalScore > 0) showLeaderboard(finalScore);
  }, 500);
}

function resetWorld() {
  // Release all active platforms
  for (let i = activePlatforms.length - 1; i >= 0; i--) {
    releasePlatform(activePlatforms[i]);
  }
  activePlatforms.length = 0;
  for (let i = activeObstacles.length - 1; i >= 0; i--) {
    releaseObstacle(activeObstacles[i]);
  }
  activeObstacles.length = 0;
  for (let i = activeShards.length - 1; i >= 0; i--) {
    releaseShard(activeShards[i]);
  }
  activeShards.length = 0;

  spawnCursorX  = 4;
  lastPlatformY = 1;
  scrollSpeed   = INITIAL_SCROLL;
  totalDistance = 0;

  const startSurface = spawnStarter();

  physics.y         = startSurface + BIKE_HH;
  physics.vy        = 0;
  physics.isGrounded = true;
  physics.coyote    = 0;
  physics.airTime   = 0;
  physics.flipAngle = 0;
  physics.flipCount = 0;
  physics.forwardBonus = 0;
  physics.boostFuel    = 1;
  pendingLandingFlips = 0;

  camera.fov = BASE_FOV;
  camera.position.z = cameraBase.z;
  camera.updateProjectionMatrix();
  cameraBase.y = physics.y + 1.2;

  colorState.phase = 0;
  colorState.t     = 0;

  nextMilestone  = MILESTONE_STEP;
  nextZoneDist   = ZONE_DISTANCE;
  milestoneTimer = 0;
  elMilestone.classList.remove('show');

  while (spawnCursorX < 30) spawnPlatform();
}

// ============================================================
// SECTION 15: MAIN UPDATE & GAME LOOP
// ============================================================

let lastTime = 0;
let paused   = document.hidden;
function syncPause() {
  paused = document.hidden || !document.hasFocus();
  input.held = false; consumeInput();
  lastTime = performance.now();
  if (paused) audio.pauseMusic();
  else if (gamePhase === 'PLAYING') audio.playMusic();
}
window.addEventListener('blur', syncPause);
window.addEventListener('focus', syncPause);

// Pause when the tab is hidden; reset the clock on resume so the first frame
// delta doesn't spike from the wall-time spent away.
document.addEventListener('visibilitychange', () => {
  paused = document.hidden || !document.hasFocus();
  input.held = false;
  consumeInput();
  if (paused) audio.pauseMusic();
  else if (gamePhase === 'PLAYING') audio.playMusic();
  if (!paused) lastTime = performance.now();
});

// Idle backdrop: slow parallax + gentle platform drift so the start menu breathes.
const IDLE_DRIFT = 1.4;
function updateIdle(delta) {
  const move = IDLE_DRIFT * delta;
  spawnCursorX -= move;
  for (let i = activePlatforms.length - 1; i >= 0; i--) {
    const p = activePlatforms[i];
    p.x -= move;
    p.group.position.x = p.x + p.width / 2;
    if (p.x + p.width < -15) {
      activePlatforms.splice(i, 1);
      releasePlatform(p);
    }
  }
  while (spawnCursorX < 30) spawnPlatform();
  updateParallax(delta);
  updateColorCycle(delta);
}

function update(delta) {
  if (gamePhase === 'IDLE') {
    if (input.justPressed) startGame();
    consumeInput();
    updateIdle(delta);
    return;
  }

  if (gamePhase === 'DEAD') {
    if (deathLockout > 0) deathLockout -= delta;
    if (deathLockout <= 0 && input.justPressed) { startGame(); return; }
    consumeInput();
    updateParticles(delta);
    updateShake(delta);
    return;
  }

  // PLAYING
  if (input.justPressed) {
    // Boost only from ground or within coyote grace after leaving it.
    if ((physics.isGrounded || physics.coyote < COYOTE_TIME) && physics.boostFuel > 0) {
      physics.boostFuel    = Math.max(0, physics.boostFuel - BOOST_FUEL_COST);
      physics.vy           = BOOST_IMPULSE;
      physics.forwardBonus = BOOST_FORWARD;
      physics.isGrounded   = false;
      physics.coyote       = COYOTE_TIME; // consume grace
      emitThrust();
      triggerShake(0.08);
      audio.boost();
    }
  }
  consumeInput();

  updatePhysics(delta);
  updateWorld(delta);
  checkCollisions();
  if (gamePhase !== 'PLAYING') return;
  awardLandingCombo();
  const reached = tickRun(run, delta, !paused);
  if (reached) {
    audio.milestone();
    riderRecord = Math.max(riderRecord, reached);
    try { localStorage.setItem('neondrift_rider_seconds', String(riderRecord)); } catch {}
  }
  updateScore(delta);
  emitTrail();            // emit before update so newly-spawned particles render this frame
  updateParticles(delta);
  updateColorCycle(delta);
  updateParallax(delta);
  updateFlipIndicator(delta);
  updateMilestone(delta);
  updateUI();

  // Speed feel: the world moves fast, but the camera language stays calm so it
  // reads as gliding, not sprinting. FOV widens only a little and eases in very
  // slowly (never snaps), and the camera drifts back a touch for depth. The
  // fast parallax + stretched trail sell the velocity; the framing sells the calm.
  const effSpeed  = scrollSpeed + physics.forwardBonus;
  const speedNorm = Math.min(1, (effSpeed - INITIAL_SCROLL) / (SCROLL_MAX + BOOST_FORWARD - INITIAL_SCROLL));
  const targetFov = BASE_FOV + speedNorm * 9;
  camera.fov += (targetFov - camera.fov) * 2.5 * delta;
  camera.updateProjectionMatrix();

  const targetZ = 10 + speedNorm * 1.6;
  camera.position.z += (targetZ - camera.position.z) * 2 * delta;

  // Camera follow (vertical) + slight forward lead
  const targetY = physics.y + 1.2;
  camera.position.y += (targetY - camera.position.y) * CAMERA_LAG * delta;
  cameraBase.y = camera.position.y;

  // Bike rotation: tilt with velocity + flip when airborne
  const tiltAngle = physics.vy * 0.045;
  if (!physics.isGrounded) {
    bikeGroup.rotation.z = physics.flipAngle + tiltAngle;
  } else {
    bikeGroup.rotation.z += (tiltAngle - bikeGroup.rotation.z) * 12 * delta;
  }
  bikeGroup.position.y = physics.y;

  // Landing shake scaled to impact speed
  if (physics.isGrounded && physics._landedThisFrame && physics._landImpact < -8) {
    triggerShake(Math.min(0.4, Math.abs(physics._landImpact) * 0.02));
    triggerLandingSpark(Math.min(1, Math.abs(physics._landImpact) * 0.05));
  }

  // Shake applied last so it offsets the settled camera position
  updateShake(delta);
}

function gameLoop(timestamp) {
  requestAnimationFrame(gameLoop);
  if (paused) { lastTime = timestamp; return; }
  const rawDelta = (timestamp - lastTime) / 1000;
  lastTime       = timestamp;
  const delta    = Math.min(rawDelta, 0.1);
  update(delta);
  drawDistricts(run.seconds, totalDistance);
  renderer.render(scene, camera);
}

requestAnimationFrame(gameLoop);
