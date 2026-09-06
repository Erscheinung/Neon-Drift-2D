# NEON DRIFT - Implementation Roadmap

Prioritized next work for the Three.js prototype (`game.js`). Ordered by impact-to-effort. Each item lists where it hooks into the existing code.

---

## Shipped (2026-08-23, feature-batch session)

- **#1 Persist best score** - `localStorage 'neondrift_best'`, loaded on init, saved in `triggerDeath`, shown on start + death screens.
- **#2 Pause on tab blur** - `visibilitychange` -> `paused` flag; `gameLoop` early-returns and resets `lastTime` on resume.
- **#3 Start-screen live backdrop** - `updateIdle()` drifts platforms + parallax while `gamePhase === 'IDLE'`.
- **#4 Collectibles** - `shardPool` / `activeShards`, `buildShard()`, spawned over gaps in `spawnPlatform`, picked up in `checkCollisions` (score + fuel refill + `audio.pickup()`).
- **#5 Boost fuel / stamina** - `physics.boostFuel` 0..1, drains per boost (`BOOST_FUEL_COST`), refills on clean landing + shards + passive grounded regen; boost gated on `> 0`; HUD bar under combo.
- **#6 More obstacle types** - pool now carries patrol/tracking drones + blink/sweep lasers; `pickObstacle(difficulty())` weights harder variants late; tracking drone eases toward `physics.y`, sweep laser rotates through the gap.
- **#7 Audio** - synth-only `audio.js` (WebAudio); boost/land/combo/crash/milestone/pickup wired; `audio.unlock()` on first gesture.
- **#8 Named zones** - `COLOR_PHASES` gained `zone` names; palette advances on distance (`ZONE_DISTANCE`, timer fallback) with an "ENTERING: <ZONE>" banner.

Remaining below: #9-#13 + known debt.

---

## P0 - Quick wins

### 1. Persist best score (localStorage)
`score.best` currently resets on reload.
- On load: `score.best = parseInt(localStorage.getItem('neondrift_best')) || 0;`
- In `triggerDeath`, after updating `score.best`: `localStorage.setItem('neondrift_best', score.best);`
- Show best on the start screen too, not just death.

### 2. Pause on tab blur / visibility change
Long `delta` after a background tab causes a physics jump (currently clamped to 0.1 in `gameLoop`, but a pause is cleaner).
- `document.addEventListener('visibilitychange', ...)` -> set a `paused` flag, skip `update` while hidden, reset `lastTime` on resume.

### 3. Start-screen live backdrop
The module-load fill already draws idle platforms. Make them scroll slowly behind the start screen so the menu feels alive (run a lightweight parallax-only update while `gamePhase === 'IDLE'`).

---

## P1 - Depth and variety

### 4. Collectibles (data shards / boost cells)
Floating pickups over gaps that add score and briefly refill a boost meter.
- New pooled system mirroring `obstaclePool` (see SECTION 5).
- Spawn in `spawnPlatform` above the surface, biased over gaps to reward risky arcs.
- Collision check in `checkCollisions` -> award points, `triggerBurst(0.4)`, small pitch-up SFX.

### 5. Boost meter / stamina
Right now boost is unlimited from ground/coyote. Add a meter to make mid-run decisions matter.
- `physics.boostFuel` 0..1, drain on boost, refill on clean landings and pickups.
- Gate the boost in the PLAYING input block on `boostFuel > 0`.
- New HUD element (radial or bar) near the combo display.

### 6. More obstacle types
Extend `obstaclePool` / `buildDrone` / `buildLaserWall`:
- Moving drone that tracks bike Y.
- Sweeping laser (rotates through the gap).
- Crushers that descend on approach.
Tie spawn weights to `difficulty()`.

### 7. Audio
No sound today. Add a small WebAudio layer (`scripts` -> new `audio.js` module):
- Boost whoosh, land thud, combo chime (pitch rises with multiplier), crash, milestone sting.
- Synth-only (OscillatorNode + gain envelopes) to avoid asset loading; matches the neon aesthetic and keeps the game a single dependency.

---

## P2 - Progression and polish

### 8. Named zones tied to color phases
`COLOR_PHASES` already cycles the palette. Give each phase a zone name shown at the milestone banner ("ENTERING: NEON SPRAWL"). Advance the phase on distance milestones instead of only on a timer, so palette = progress.

### 9. Difficulty curve tuning pass
`difficulty()` ramps over 1200m. Playtest and split into explicit bands with a lookup table (warmup / rhythm / gaps / obstacles / chaos) rather than one linear lerp, so each band has a distinct feel.

### 10. Screen-space bloom
The glow is faked with additive planes. A real post-process bloom pass (three.js `EffectComposer` + `UnrealBloomPass`) would make the neon pop and let us drop some of the manual glow meshes.

### 11. Mobile tuning
Touch works but: larger hit-forgiveness, haptics on land/crash (`navigator.vibrate`), and a portrait layout check.

---

## P3 - Meta

### 12. Daily seed / challenge mode
Seeded RNG (replace `Math.random` in generation with a seeded PRNG) so everyone gets the same course on a given day -> shareable scores.

### 13. Ghost replay
Record input timeline, replay a translucent ghost of your best run.

---

## Known code debt

- ~~`spawnObstacle` laser branch hardcodes `w`/`h` each spawn~~ - FIXED: dims now come from pooled `LASER_W`/`LASER_H`/`DRONE_W`/`DRONE_H` consts.
- Trail/burst/thrust systems repeat the same buffer-update boilerplate; a small `ParticleSystem` helper would DRY SECTION 11. Shard bob/spin is a fourth near-copy now.
- `resetWorld` and the module-load fill both seed terrain; unify.
- `updateColorCycle` (zones) and `updateMilestone` both write `#milestone-banner`; on a colliding frame the 250m milestone can override a zone banner. Give zones a priority lock if it becomes visible.
