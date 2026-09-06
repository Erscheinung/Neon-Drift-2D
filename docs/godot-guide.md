# NEON DRIFT → Godot 4 Replication Guide

How to port this game from the Three.js browser prototype to Godot 4 (2D).

This guide tracks the **current** prototype mechanics (`game.js`), which is a **momentum glide-runner**, not a flappy hopper:

- Tap = boost up + forward; hold = glide; release-while-falling = dive.
- Boost gated to ground / coyote-time (no infinite mid-air pogo).
- Flips bank on clean landing into a combo multiplier.
- Endless procedural terrain with a spawn frontier that rides the world.
- Difficulty ramps slowly over a long distance; distance milestones flash a banner.
- Thrust jet particles on boost, speed-driven camera FOV, impact-scaled screen shake.
- Pooled obstacles: a Y-bobbing drone and a blinking laser wall, spawn-weighted by difficulty.
- Palette cycles through named color-phase zones as you travel.

This session's feature batch (mirrors `docs/roadmap.md` P0-P2), all covered below:
- Synth SFX on an audio bus, one `AudioStreamPlayer` per cue.
- Boost fuel/stamina meter draining on boost, refilling on clean-land + pickups.
- Pooled collectible shards spawned over gaps.
- New obstacle behaviours: a drone that tracks the bike's Y, and a sweeping/rotating laser.
- Named zones advancing on distance milestones (palette = progress).
- Best-score persistence via `user://` `ConfigFile` (the localStorage equivalent).
- Auto-pause on window focus loss.

> Section 8 covers the base polish. Sections 9-15 cover the feature batch. The
> **Session progression log** at the very end maps each git/session milestone to
> the Godot system it corresponds to, so this guide reads as a build-along that
> tracks how the JS source actually evolved.

---

## 1. Project Setup

**New project → choose "Compatibility" renderer** (works on mobile and web exports).
Use "Forward+" only if you want advanced shaders on desktop-only builds.

Project Settings:
- Display → Window → Size: `1280 × 720`
- Display → Window → Stretch → Mode: `canvas_items`
- Display → Window → Stretch → Aspect: `keep_width`

Set background color: Project → Project Settings → Rendering → Environment → Default Clear Color → `#0d0020`.

Create this folder structure inside `res://`:
```
res://
  scenes/
    bike.tscn
    platform.tscn
    drone.tscn
    laser_wall.tscn
    shard.tscn
    main.tscn
  scripts/
    bike.gd
    level_manager.gd
    score_manager.gd
    game_events.gd
    camera_shake.gd
    audio_bus.gd
    zone_manager.gd
  assets/
    sprites/
    fonts/
```

---

## 2. Momentum Physics in GDScript

Use `CharacterBody2D` for the bike — not `RigidBody2D`. You need manual velocity control.

**Important:** Godot 2D Y-axis is **inverted** from Three.js. Positive Y = down. So "boost up" means a **negative** `velocity.y`.

The movement is a **momentum glide**, not a flap:
- **Tap** = boost up **and** forward (a decaying horizontal speed bonus).
- **Hold** = glide (reduced gravity, floats).
- **Release while falling** = dive (extra gravity for tight-gap control).
- Boost is only allowed from the ground or within a short **coyote-time** grace after leaving a ledge — no infinite mid-air pogo.
- Flips accumulate across the whole air phase and are banked on a clean landing; boosting does **not** reset the flip count.

```gdscript
# scripts/bike.gd
extends CharacterBody2D

const GRAVITY        = 900.0    # px/s² normal fall (positive = down)
const GLIDE_GRAVITY  = 240.0    # while holding: floats
const DIVE_GRAVITY   = 1600.0   # released past apex, falling: hard dive
const BOOST_IMPULSE  = -420.0   # negative = upward kick
const BOOST_FORWARD  = 180.0    # px/s forward bonus added to scroll on boost
const FORWARD_DECAY  = 90.0     # px/s² bleed-off of the forward bonus
const MAX_FALL_SPEED = 900.0
const MAX_RISE_SPEED = 520.0
const COYOTE_TIME    = 0.12

var is_holding    := false
var coyote        := 0.0        # time since leaving ground
var flip_angle    := 0.0
var flip_count    := 0
var forward_bonus := 0.0        # read by LevelManager to speed the world up

func _physics_process(delta: float) -> void:
    # Pick gravity by state
    var g := GRAVITY
    if is_on_floor():
        g = GRAVITY
    elif is_holding:
        g = GLIDE_GRAVITY
    elif velocity.y > 0.0:       # falling (positive = down)
        g = DIVE_GRAVITY
    velocity.y += g * delta
    velocity.y = clamp(velocity.y, -MAX_RISE_SPEED, MAX_FALL_SPEED)

    # Forward bonus decays back to 0
    if forward_bonus > 0.0:
        forward_bonus = max(0.0, forward_bonus - FORWARD_DECAY * delta)

    # Coyote + flips while airborne
    if not is_on_floor():
        coyote += delta
        flip_angle += 3.2 * PI * delta
        if flip_angle >= TAU:
            flip_angle -= TAU
            flip_count += 1
            GameEvents.flip_counted.emit(flip_count)
    else:
        coyote = 0.0

    move_and_slide()

    # Nose tilt with vertical velocity; full flip rotation when airborne
    var tilt := velocity.y * 0.0006
    $Sprite2D.rotation = flip_angle + tilt if not is_on_floor() else lerp($Sprite2D.rotation, tilt, 12.0 * delta)

func _input(event: InputEvent) -> void:
    if event.is_action_pressed("boost"):
        # Gate: only from ground or within coyote grace
        if is_on_floor() or coyote < COYOTE_TIME:
            velocity.y    = BOOST_IMPULSE
            forward_bonus = BOOST_FORWARD
            coyote        = COYOTE_TIME     # consume grace
            is_holding    = true
            GameEvents.boosted.emit()       # drives thrust particles + shake
        else:
            is_holding = true               # still track hold for glide
    if event.is_action_released("boost"):
        is_holding = false

func on_just_landed() -> void:
    GameEvents.player_landed.emit(flip_count)  # bank flips into combo
    flip_count = 0
    flip_angle = 0.0
```

In `Project Settings → Input Map`, add action `boost`:
- Keyboard: `Space`
- Joypad: any button
- Screen touch: handled separately (see below)

For mobile touch input, add to `main.tscn` root script:
```gdscript
func _input(event: InputEvent) -> void:
    if event is InputEventScreenTouch:
        if event.pressed:
            Input.action_press("boost")
        else:
            Input.action_release("boost")
```

---

## 3. Procedural Level Generation

Create `platform.tscn`. Match the prototype's readable look: a lit top rail and glowing end caps so gaps read clearly.
```
StaticBody2D (platform.gd)
  CollisionShape2D  (RectangleShape2D)
  ColorRect         (dark body, #1a0838)
  Line2D            (bright top rail, color #00e5ff, width 4)
  Line2D            (left end cap, #00e5ff)   # vertical, marks where the gap begins
  Line2D            (right end cap, #00e5ff)
```

`platform.gd`:
```gdscript
extends StaticBody2D

func setup(x: float, y: float, w: float) -> void:
    position = Vector2(x + w / 2.0, y)
    $CollisionShape2D.shape.size = Vector2(w, 40)
    $ColorRect.size              = Vector2(w, 40)
    $ColorRect.position          = Vector2(-w / 2.0, -20)
    $Rail.points                 = [Vector2(-w / 2.0, -22), Vector2(w / 2.0, -22)]
    $Rail.width                  = 4
    $Rail.default_color          = Color(0.0, 0.9, 1.0)   # #00e5ff
    $CapL.points                 = [Vector2(-w / 2.0, -28), Vector2(-w / 2.0, 10)]
    $CapR.points                 = [Vector2( w / 2.0, -28), Vector2( w / 2.0, 10)]
    for cap in [$CapL, $CapR]:
        cap.width = 3
        cap.default_color = Color(0.0, 0.9, 1.0)
```

`level_manager.gd` (Autoload — register in Project Settings → Autoload):
```gdscript
extends Node

const POOL_SIZE    = 20
const SCROLL_START = 330.0   # px/s
const SCROLL_ACCEL = 0.66    # per second (slow, long ramp)
const SCROLL_MAX   = 900.0
const GAP_MIN      = 90.0
const GAP_MAX      = 240.0
const PLAT_W_MIN   = 180.0
const PLAT_W_MAX   = 480.0
const SPAWN_AHEAD  = 1800.0  # keep the frontier this far right of origin

var platform_scene = preload("res://scenes/platform.tscn")
var pool:   Array[Node] = []
var active: Array[Node] = []
var spawn_x:    float = 800.0
var last_y:     float = 400.0
var scroll_speed: float = SCROLL_START
var total_dist:   float = 0.0

# Difficulty ramps slowly over a long distance (0 -> 1 near ~72000 px ~= 1200 "m").
func difficulty() -> float:
    return min(1.0, total_dist / 72000.0)

func _ready() -> void:
    for i in POOL_SIZE:
        var p = platform_scene.instantiate()
        p.visible = false
        add_child(p)
        pool.append(p)
    _spawn_starter()
    while spawn_x < SPAWN_AHEAD:
        _spawn_platform()

func _process(delta: float) -> void:
    scroll_speed = min(SCROLL_MAX, scroll_speed + SCROLL_ACCEL * delta)
    var eff := scroll_speed  # + bike.forward_bonus (wire the bike ref in)
    var move = eff * delta
    total_dist += move
    spawn_x -= move          # CRITICAL: frontier rides the world so refill keeps firing

    for p in active:
        p.position.x -= move

    for i in range(active.size() - 1, -1, -1):
        var p = active[i]
        if p.position.x + p.get_node("CollisionShape2D").shape.size.x / 2.0 < -200:
            p.visible = false
            pool.append(p)
            active.remove_at(i)

    while spawn_x < SPAWN_AHEAD:
        _spawn_platform()

func _spawn_starter() -> void:
    # Long safe runway under the bike so the player starts grounded, not falling.
    if pool.is_empty(): return
    var p = pool.pop_back()
    var w = 720.0
    p.setup(-200.0, last_y, w)
    p.visible = true
    active.append(p)
    spawn_x = -200.0 + w + GAP_MIN

func _spawn_platform() -> void:
    if pool.is_empty(): return
    var d = difficulty()
    var p = pool.pop_back()

    # Width: wide/forgiving early, narrows as d rises
    var w_max = PLAT_W_MAX - (PLAT_W_MAX - 300.0) * d
    var w_min = PLAT_W_MIN + (1.0 - d) * 120.0
    var w = max(PLAT_W_MIN, w_min + randf() * max(60.0, w_max - w_min))

    # Height swing grows with difficulty
    var swing = 48.0 + d * 132.0
    last_y = clamp(last_y + randf_range(-swing, swing), 300.0, 560.0)

    p.setup(spawn_x, last_y, w)
    p.visible = true
    active.append(p)

    # Gap widens slowly; full range only near max difficulty
    var gap = GAP_MIN + randf() * (GAP_MAX - GAP_MIN) * (0.15 + 0.85 * d)
    spawn_x += w + gap

    # Obstacles introduced gradually, never on narrow platforms
    var obs_chance = max(0.0, d - 0.15) * 0.5
    if w >= 260.0 and randf() < obs_chance:
        _spawn_obstacle(p)   # see obstacle pool, mirror of platform pool
```

> **The one bug that made the prototype "3 blocks long":** `spawn_x` (the spawn frontier) must be decremented by `move` every frame. If it stays fixed, the `while spawn_x < SPAWN_AHEAD` refill fires once at startup and never again — you get a handful of platforms, then void. This is the single most important line to port correctly.


---

## 4. Parallax Layers in Godot

Use the built-in `ParallaxBackground` + `ParallaxLayer` node tree. These scroll automatically based on the camera's position.

Node setup inside `main.tscn`:
```
Main
  ParallaxBackground
    ParallaxLayer (distant spires)
      motion_scale = Vector2(0.1, 0)
      motion_mirroring = Vector2(1280, 0)
      [child: Sprite2D or Polygon2D shapes for spires]
    ParallaxLayer (fog)
      motion_scale = Vector2(0.35, 0)
      motion_mirroring = Vector2(1280, 0)
      [child: ColorRect strips with alpha ~25]
  Camera2D
  LevelManager (autoload, or instance here)
  Bike
```

For procedural spires at runtime, in the spire layer's script:
```gdscript
func _ready() -> void:
    for i in 10:
        var rect = ColorRect.new()
        rect.size     = Vector2(randf_range(10, 40), randf_range(150, 500))
        rect.color    = Color(0.05, 0, 0.1)
        rect.position = Vector2(i * 130, 720 - rect.size.y)
        add_child(rect)
        # Neon outline via Line2D
        var line = Line2D.new()
        line.points = PackedVector2Array([
            Vector2(0, 0), Vector2(rect.size.x, 0),
            Vector2(rect.size.x, rect.size.y), Vector2(0, rect.size.y), Vector2(0, 0)
        ])
        line.width = 1.5
        line.default_color = Color(0.4, 0, 0.8)
        rect.add_child(line)
```

---

## 5. Combo / Score System with Signals

Create `game_events.gd` (Autoload as `GameEvents`):
```gdscript
# scripts/game_events.gd
extends Node

signal score_changed(new_score: int)
signal combo_changed(multiplier: int, combo: int)
signal player_died
signal player_landed(flip_count: int)
signal flip_counted(total: int)
```

`score_manager.gd` (Autoload as `ScoreManager`):
```gdscript
extends Node

var points:     int = 0
var multiplier: int = 1
var combo:      int = 0
var combo_timer: float = 0.0
var best:       int = 0

const COMBO_TIMEOUT = 3.0

func _ready() -> void:
    GameEvents.player_landed.connect(_on_landed)
    GameEvents.player_died.connect(_on_died)

func _process(delta: float) -> void:
    # Distance score
    points += int(LevelManager.scroll_speed * delta * 0.1)
    GameEvents.score_changed.emit(points)

    if combo_timer > 0:
        combo_timer -= delta
        if combo_timer <= 0:
            combo      = 0
            multiplier = 1
            GameEvents.combo_changed.emit(multiplier, combo)

func _on_landed(flip_count: int) -> void:
    if flip_count <= 0: return
    combo      += flip_count
    multiplier  = 5 if combo >= 10 else (3 if combo >= 6 else (2 if combo >= 3 else 1))
    points     += flip_count * 100 * multiplier
    combo_timer = COMBO_TIMEOUT
    GameEvents.combo_changed.emit(multiplier, combo)
    GameEvents.score_changed.emit(points)

func _on_died() -> void:
    best = max(best, points)

func reset() -> void:
    points      = 0
    multiplier  = 1
    combo       = 0
    combo_timer = 0.0
```

In your HUD scene, connect label updates to signals:
```gdscript
func _ready() -> void:
    GameEvents.score_changed.connect(func(s): $ScoreLabel.text = str(s).lpad(6, "0"))
    GameEvents.combo_changed.connect(func(m, c): $MultLabel.text = "x" + str(m))
```

---

## 6. Importing Procreate Assets

1. In Procreate: `Share → PNG` (transparent background, sRGB color profile).
2. AirDrop to Mac or use Files app to transfer.
3. Drag PNG into `res://assets/sprites/` in the Godot FileSystem dock.
4. Select the PNG → **Import** dock (top-right in Godot):
   - Compress: `Lossless` (for sharp sprites)
   - Filter: `Nearest` for pixel art, `Linear` for smooth painted look
   - Mipmaps: `Off` (2D only)
   - Click **Reimport**

For the hover-bike with animation frames:
1. Export each frame as a separate PNG (`bike_idle.png`, `bike_lean_fwd.png`, `bike_lean_back.png`).
2. In the bike scene, replace `Sprite2D` with `AnimatedSprite2D`.
3. In the Inspector, click `SpriteFrames → New SpriteFrames`.
4. Open the SpriteFrames editor at the bottom. Add animations: `idle`, `lean_fwd`, `lean_back`.
5. Drag each PNG into its animation. Set FPS to 8.
6. In `bike.gd`, call `$AnimatedSprite2D.play("lean_fwd")` when rising, `"lean_back"` when falling, `"idle"` when grounded.

---

## 7. Particle Trails (GPUParticles2D)

In the bike scene, add a child node: `GPUParticles2D`.

Inspector settings:
```
Amount:          80
Lifetime:        0.8
Speed Scale:     1.0
Local Coords:    false      ← particles stay in world space (not attached to bike)
Emitting:        true
```

Create a **New ParticleProcessMaterial** on the `Process Material` slot:

```
Direction:            Vector3(-1, 0, 0)
Spread:               15
Initial Velocity Min: 80
Initial Velocity Max: 150
Gravity:              Vector3(0, 200, 0)
Scale Min/Max:        8 / 4
Color Ramp:           Gradient — cyan (#00ffff, alpha 1.0) → magenta (#ff00cc, alpha 0.0)
```

For Draw Passes, assign a new `CanvasItemMaterial` with **Blend Mode: Add** — this gives the neon additive glow.

Position the `GPUParticles2D` at `Vector2(-30, 0)` relative to bike center (exhaust position).

To enable/disable trail:
```gdscript
$GPUParticles2D.emitting = is_alive
```

---

## 8. Polish

### Screen Shake
```gdscript
# scripts/camera_shake.gd — attach to Camera2D
extends Camera2D

var shake_intensity := 0.0
const SHAKE_DECAY = 200.0  # pixels/sec²

func trigger_shake(amount: float) -> void:
    shake_intensity = amount

func _process(delta: float) -> void:
    if shake_intensity > 0:
        offset = Vector2(
            randf_range(-1, 1) * shake_intensity,
            randf_range(-1, 1) * shake_intensity
        )
        shake_intensity = move_toward(shake_intensity, 0, SHAKE_DECAY * delta)
    else:
        offset = Vector2.ZERO
```

Wire it up:
```gdscript
# In main.gd
func _ready() -> void:
    GameEvents.player_died.connect(func(): $Camera2D.trigger_shake(20.0))
```

### Sound (no assets needed)
Prototype the boost sound with `pitch_scale` variation:
```gdscript
$BoostSound.pitch_scale = 0.8 + randf() * 0.4
$BoostSound.play()
```
Full cue-to-event mapping on a dedicated audio bus is in **Section 13**.

### Neon Glow on Sprites
Godot doesn't have additive blending on `Sprite2D` by default. Enable it:
1. Select the sprite → Inspector → `CanvasItem → Material`.
2. Create new `CanvasItemMaterial` → `Blend Mode: Add`.

For a bloom/glow look without shaders: duplicate the sprite, set it to Add blend, scale to 1.05, reduce alpha to 80. Parent both under a `Node2D`.

---

## 9. Obstacle Pool (drone + laser wall)

The prototype pools six obstacles (`obstaclePool`), four drones and two laser
walls, and attaches one to a platform in `spawnPlatform` once difficulty crosses
~0.15. Mirror the platform pool exactly: pre-instance, hide, recycle by `x`.

`drone.tscn` — an `Area2D` (it only needs to detect the bike, not collide physically):
```
Area2D (drone.gd)
  CollisionShape2D  (RectangleShape2D ~40x30)
  Polygon2D / Line2D  (neon body, #ff3300 outline)
  Line2D              (downward beam, #ff3300 alpha ~0.4)
```

`laser_wall.tscn` — also an `Area2D`, tall and thin:
```
Area2D (laser_wall.gd)
  CollisionShape2D  (RectangleShape2D ~10x300)
  Line2D            (beam, #ff0033)
  Polygon2D x2      (emitter boxes top/bottom)
```

Use `Area2D`, not `StaticBody2D`: the bike is a `CharacterBody2D` that should
pass *through* the hazard's zone and die on overlap, not be blocked by it. Wire
`body_entered` to death:
```gdscript
# drone.gd / laser_wall.gd
func _ready() -> void:
    body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node) -> void:
    if body.is_in_group("player"):
        GameEvents.player_died.emit()
```

Base behaviours (extended in Section 12):
- **Drone** bobs vertically around a `base_y` with `sin(time * 2 + phase_offset) * 0.3`.
- **Laser wall** blinks on a 0.5s timer; while off it disables its `CollisionShape2D` so it can't kill (`$CollisionShape2D.disabled = not blink_on`), matching the JS `obs.active = obs.blinkOn` gate.

Add to `level_manager.gd`:
```gdscript
const OBSTACLE_POOL_SIZE = 6
var drone_scene  = preload("res://scenes/drone.tscn")
var laser_scene  = preload("res://scenes/laser_wall.tscn")
var obs_pool:   Array[Node] = []
var obs_active: Array[Node] = []

func _init_obstacles() -> void:      # call from _ready()
    for i in OBSTACLE_POOL_SIZE:
        var o = (drone_scene if i < 4 else laser_scene).instantiate()
        o.visible = false
        o.set_process(false)
        add_child(o)
        obs_pool.append(o)

func _spawn_obstacle(platform) -> void:
    if obs_pool.is_empty(): return
    var o = obs_pool.pop_back()
    o.setup(platform)               # positions relative to platform surface
    o.visible = true
    o.set_process(true)
    obs_active.append(o)
```

Recycle obstacles in `_process` alongside platforms: decrement each by `move`,
and when `position.x < -200` hide, `set_process(false)`, push back to `obs_pool`.

---

## 10. Collectible Shards (pooled, over gaps)

Roadmap P1 #4. A third pool, mirroring the obstacle pool, spawns pickups biased
over gaps so risky arcs are rewarded. In `spawnPlatform` the JS advances
`spawnCursorX` by `w + gap`; spawn a shard at roughly `spawn_x_before + w + gap/2`,
elevated above `last_y`, so it floats in the gap's mouth.

`shard.tscn`:
```
Area2D (shard.gd)
  CollisionShape2D  (CircleShape2D r~16)
  Polygon2D / Sprite2D  (diamond, #00e5ff, Add blend for glow)
  AnimationPlayer   (idle spin / bob loop)
```

`shard.gd`:
```gdscript
extends Area2D

var spin := 0.0

func _ready() -> void:
    add_to_group("shards")
    body_entered.connect(_on_body_entered)

func setup(x: float, y: float) -> void:
    position = Vector2(x, y)

func _process(delta: float) -> void:
    spin += delta
    position.y += sin(spin * 3.0) * 0.4          # gentle bob
    $Polygon2D.rotation = spin * 2.0

func _on_body_entered(body: Node) -> void:
    if body.is_in_group("player"):
        GameEvents.shard_collected.emit()        # score + fuel refill (Sec 11)
        _recycle()                               # LevelManager pushes back to pool
```

Pooling is identical to Section 9: pre-instance `SHARD_POOL_SIZE`, hide, recycle
past `x < -200`. Add `signal shard_collected` to `game_events.gd`.

`ScoreManager` awards on the signal, and fires a small burst + a rising-pitch SFX:
```gdscript
func _on_shard() -> void:
    points += 50 * multiplier
    GameEvents.score_changed.emit(points)
    AudioBus.play("shard")      # see Section 13
```

---

## 11. Boost Fuel / Stamina Meter

Roadmap P1 #5. Today the JS boost is unlimited from ground/coyote. Add a
`0.0..1.0` fuel value on the bike that boost drains and clean landings + shard
pickups refill. This turns "tap freely" into a resource decision.

Extend `bike.gd`:
```gdscript
const BOOST_COST      = 0.25    # fuel per boost
const LAND_REFILL     = 0.35    # refill on a clean landing
const SHARD_REFILL    = 0.20    # refill per shard
const FUEL_REGEN      = 0.05    # slow passive regen per second

var boost_fuel := 1.0

func _physics_process(delta: float) -> void:
    # ... existing gravity / coyote / flip logic ...
    if boost_fuel < 1.0:
        boost_fuel = min(1.0, boost_fuel + FUEL_REGEN * delta)
    GameEvents.fuel_changed.emit(boost_fuel)
```

Gate the boost on fuel, and spend it — this is the direct analogue of the JS
`if (physics.isGrounded || physics.coyote < COYOTE_TIME)` gate, now with a fuel
term ANDed in:
```gdscript
func _input(event: InputEvent) -> void:
    if event.is_action_pressed("boost"):
        var can_boost := (is_on_floor() or coyote < COYOTE_TIME) and boost_fuel >= BOOST_COST
        if can_boost:
            velocity.y    = BOOST_IMPULSE
            forward_bonus = BOOST_FORWARD
            coyote        = COYOTE_TIME
            boost_fuel   -= BOOST_COST
            is_holding    = true
            GameEvents.boosted.emit()
        else:
            is_holding = true       # still glide, just no upward kick
    if event.is_action_released("boost"):
        is_holding = false

func on_just_landed() -> void:
    boost_fuel = min(1.0, boost_fuel + LAND_REFILL)   # clean-land refill
    GameEvents.player_landed.emit(flip_count)
    flip_count = 0
    flip_angle = 0.0
```

Refill on shard pickup by connecting `shard_collected` on the bike:
```gdscript
func _ready() -> void:
    GameEvents.shard_collected.connect(func():
        boost_fuel = min(1.0, boost_fuel + SHARD_REFILL))
```

HUD meter near the combo display — a `TextureProgressBar` (radial) or a plain
`ProgressBar`, driven off `fuel_changed`:
```gdscript
func _ready() -> void:
    GameEvents.fuel_changed.connect(func(f): $FuelBar.value = f * 100.0)
```
Add `signal fuel_changed(fuel: float)` to `game_events.gd`.

---

## 12. Advanced Obstacle Behaviours

Roadmap P1 #6. Extend the two base obstacles from Section 9 into the tracking
drone and sweeping laser. Both read the bike through a group lookup so they don't
need a hard reference.

**Y-tracking drone** — eases toward the bike's Y instead of only bobbing:
```gdscript
# drone.gd
@export var track_speed := 2.0
var base_y := 0.0
var phase  := 0.0

func setup(platform) -> void:
    base_y  = platform.surface_y() - 120.0
    phase   = randf() * TAU
    position = Vector2(platform.spawn_ref_x(), base_y)

func _process(delta: float) -> void:
    var player = get_tree().get_first_node_in_group("player")
    if player:
        # ease toward bike Y, clamped so it stays a beatable threat
        var target_y = clamp(player.global_position.y, base_y - 80.0, base_y + 120.0)
        base_y = lerp(base_y, target_y, track_speed * delta)
    phase += delta * 2.0
    position.y = base_y + sin(phase) * 12.0        # residual bob on top of tracking
```

**Sweeping / rotating laser** — the emitter pivots, sweeping the beam through the
gap (rotate the whole `Area2D` so the `CollisionShape2D` sweeps with the visual):
```gdscript
# laser_wall.gd  (sweeping variant)
@export var sweep_speed := 1.5
@export var sweep_arc   := deg_to_rad(60.0)
var sweep_t := 0.0
var blink_on := true
var blink_timer := 0.0

func _process(delta: float) -> void:
    sweep_t += delta * sweep_speed
    rotation = sin(sweep_t) * sweep_arc            # pivot the beam across the gap

    blink_timer += delta
    if blink_timer > 0.5:
        blink_timer = 0.0
        blink_on = not blink_on
        $Beam.visible = blink_on
        $CollisionShape2D.disabled = not blink_on   # off = harmless, matches JS obs.active
```

Weight which behaviour spawns by `difficulty()` in `_spawn_obstacle`: bobbing
drones and plain blinking lasers early, tracking drones and sweepers late.

---

## 13. Audio Bus + Synth SFX

Roadmap P1 #7. The JS plan is WebAudio oscillators (no asset files). In Godot,
route everything through a dedicated **audio bus** and give each cue its own
`AudioStreamPlayer`. You can drive them with short imported CC0 clips or with
procedural `AudioStreamGenerator` streams for the pure-synth neon feel.

**Bus layout** (Audio panel at the bottom of the editor → add bus `SFX`, route to
`Master`, add a `Reverb` or `EQ` effect if you want the arcade sheen):
```
Master
  SFX        ← volume slider the player can mute; add Limiter effect here
```

`audio_bus.gd` (Autoload as `AudioBus`) — one player per cue, mapped to game events:
```gdscript
extends Node

@onready var players := {
    "boost":     $Boost,
    "land":      $Land,
    "combo":     $Combo,
    "shard":     $Shard,
    "crash":     $Crash,
    "milestone": $Milestone,
}

func _ready() -> void:
    for p in players.values():
        p.bus = "SFX"
    GameEvents.boosted.connect(func():        play("boost"))
    GameEvents.player_landed.connect(func(_f): play("land"))
    GameEvents.combo_changed.connect(_on_combo)
    GameEvents.shard_collected.connect(func(): play("shard"))
    GameEvents.player_died.connect(func():     play("crash"))
    GameEvents.zone_entered.connect(func(_n):  play("milestone"))

func play(cue: String) -> void:
    var p: AudioStreamPlayer = players[cue]
    p.pitch_scale = 0.9 + randf() * 0.2       # slight variation per hit
    p.play()

func _on_combo(multiplier: int, _combo: int) -> void:
    var p: AudioStreamPlayer = players["combo"]
    p.pitch_scale = 1.0 + multiplier * 0.15   # chime rises with multiplier
    p.play()
```

Scene: an `AudioBus` node with six `AudioStreamPlayer` children named `Boost`,
`Land`, `Combo`, `Shard`, `Crash`, `Milestone`. For the procedural route, assign
each an `AudioStreamGenerator` and push samples in `_ready`; for the quick route,
drop in six short CC0 blips and set each player's stream.

---

## 14. Zones, Persistence, and Focus Pause

### Named zones tied to color phases (roadmap P2 #8)
The JS `COLOR_PHASES` cycles on a 30s timer (`updateColorCycle`). Instead, advance
the phase on **distance milestones** so palette equals progress, and name each
zone. Extend the color/zone manager:
```gdscript
const ZONES = [
    { "name": "NEON SPRAWL",   "sky": Color("050010"), "line": Color("9945ff") },
    { "name": "TEAL DESCENT",  "sky": Color("001515"), "line": Color("00ffcc") },
    { "name": "MAGENTA CORE",  "sky": Color("150010"), "line": Color("ff00cc") },
]
const ZONE_STEP = 250.0        # advance one zone per 250 "m", matches MILESTONE_STEP

var zone_index := 0
var next_zone_at := ZONE_STEP

func _process(_delta: float) -> void:
    if ScoreManager.distance() >= next_zone_at:
        zone_index = (zone_index + 1) % ZONES.size()
        next_zone_at += ZONE_STEP
        _apply_zone(ZONES[zone_index])
        GameEvents.zone_entered.emit(ZONES[zone_index].name)   # HUD banner + SFX
```
Lerp `_apply_zone` toward the new palette (tween the clear color, platform
`Line2D` colors, and bike color) rather than snapping. The HUD shows
`"ENTERING: " + zone_name` on the milestone banner. Add `signal zone_entered(zone_name: String)`.

### Best-score persistence (roadmap P0 #1)
The JS plan uses `localStorage`. The Godot equivalent is a `ConfigFile` under
`user://` (the per-user, per-platform writable dir; survives exits and web
exports via IndexedDB). Load on boot, save on death:
```gdscript
# in ScoreManager
const SAVE_PATH = "user://neondrift.cfg"

func _ready() -> void:
    var cfg := ConfigFile.new()
    if cfg.load(SAVE_PATH) == OK:
        best = cfg.get_value("score", "best", 0)
    # ... existing signal connections ...

func _on_died() -> void:
    if points > best:
        best = points
        var cfg := ConfigFile.new()
        cfg.set_value("score", "best", best)
        cfg.save(SAVE_PATH)          # localStorage.setItem equivalent
```
Show `best` on both the start and death screens.

### Auto-pause on focus loss (roadmap P0 #2)
The JS clamps `delta` to 0.1 to survive a backgrounded tab; a real pause is
cleaner. Godot delivers `NOTIFICATION_APPLICATION_FOCUS_OUT` / `_IN`; flip
`get_tree().paused`. On the main node:
```gdscript
func _notification(what: int) -> void:
    match what:
        NOTIFICATION_APPLICATION_FOCUS_OUT:
            get_tree().paused = true
        NOTIFICATION_APPLICATION_FOCUS_IN:
            get_tree().paused = false
```
Set the pause `process_mode` deliberately: the HUD/pause overlay should be
`PROCESS_MODE_ALWAYS`; gameplay nodes stay `PROCESS_MODE_PAUSABLE` (the default)
so they freeze. This removes the need for the JS `delta` clamp entirely.

---

## 15. Session Progression Log

This guide is a build-along. Each row maps a real milestone in the JS source
(git commit `49cf87f` plus the two `2026-08-23` session logs) to the Godot system
that reproduces it. Build in this order and the Godot port evolves the same way
the prototype did.

| # | JS source milestone | What changed in `game.js` | Godot system (section) |
|---|---|---|---|
| 1 | **Momentum glide rework** (commit `49cf87f`, log 1) | Boost = up + forward (`BOOST_FORWARD` decaying via `FORWARD_DECAY`); hold = `GLIDE_GRAVITY`, release-falling = `DIVE_GRAVITY`; boost gated to ground/`COYOTE_TIME`; flips bank on clean landing into x2/x3/x5. Camera-shake fixed to offset a stable `cameraBase`. | `bike.gd` state-based gravity + coyote gate (Sec 2); `ScoreManager` flip banking via `player_landed` signal (Sec 5); `camera_shake.gd` offset, not cumulative (Sec 8). |
| 2 | **Restart-bug fix** (log 2) | `startGame` `clearTimeout`s the pending death-screen timer; `triggerDeath` clears `input.held` + `deathLockout = 0.5`; keydown uses `e.repeat`; overlay `pointerdown` retry handlers. | Game state machine + input actions (Sec 2); a `restart_lockout` timer before accepting the retry press; overlay buttons that consume their own input. |
| 3 | **Endless spawn frontier fix** (log 2) | Root cause: `spawnCursorX` never scrolled, so `while (spawnCursorX < N)` fired once then stopped. Fix: `spawnCursorX -= move` each frame; lookahead x=30; `POOL_SIZE` 14→20. | `level_manager.gd` `spawn_x -= move` every `_process` (Sec 3, the flagged CRITICAL line) + platform pool recycling. |
| 4 | **Difficulty ramp + readability** (log 2) | `difficulty()` over ~1200m; wide/gentle early → narrow/tall/wide-gap late; obstacles hold to ~180m; `INITIAL_SCROLL` 6.5→5.5, `SCROLL_ACCEL` 0.02→0.011; milestone banner every 250m; lit rails + end caps. | `difficulty()` in `level_manager.gd`, width/swing/gap/obstacle-chance lerps (Sec 3); milestone banner; `platform.tscn` lit rail + caps (Sec 3). |
| 5 | **This session's feature batch** (roadmap P0-P2) | Planned: synth SFX, boost fuel meter, collectible shards, tracking drone + sweeping laser, named distance zones, best-score persistence, focus pause. | Audio bus + `AudioStreamPlayer` map (Sec 13); `boost_fuel` on `bike.gd` (Sec 11); shard pool (Sec 10); advanced obstacle behaviours (Sec 12); zone advance on distance (Sec 14); `user://` `ConfigFile` (Sec 14); `NOTIFICATION_APPLICATION_FOCUS_OUT` pause (Sec 14). |

> Milestones 1-4 are shipped in the JS prototype and their Godot mappings are
> exact ports. Milestone 5 is the roadmap-driven batch: the JS side may still be
> landing these, so treat those sections as the intended parity target rather
> than a line-for-line port of existing code.

---

## Asset Import Checklist

| Asset | Node type | Blend mode | Filter |
|---|---|---|---|
| Bike (animated) | AnimatedSprite2D | Normal | Nearest |
| Platform tiles | NinePatchRect | Normal | Linear |
| City spires | Sprite2D | Normal | Linear |
| Glow dot | Sprite2D | Add | Linear |
| Trail particles | GPUParticles2D draw pass | Add | Linear |
| Drone / laser wall | Area2D + Line2D/Polygon2D | Add | Linear |
| Collectible shard | Area2D + Polygon2D | Add | Linear |
| Fuel meter | TextureProgressBar (radial) | Normal | Linear |
| UI score panel | NinePatchRect | Normal | Linear |
| Combo badge ring | Sprite2D | Normal | Linear |

---

## 16. Procedural Neon-City Background (updated web parity)

The web build replaced the simple spire ColorRects (Sec 4) with a **procedural
neon-city skyline**: three parallax depth layers of generated skyscrapers with
lit window grids, neon roof edges, a moon, drifting clouds, twinkling stars, and
a rippling water reflection. This section covers (a) designing/iterating the art
off-Godot and (b) porting the generator to Godot 4.

### 16a. Designing the look off-Godot (iPad / Pixelorama / any sprite editor)

You do not need to hand-author full skylines — the generator draws them. Author
the *building tiles* and *palette*, then let code assemble the city. Iterate the
tiles where it is fastest for you:

- **iPad (Procreate / Pixaki):** paint a set of building silhouettes on a
  transparent canvas, one building per layer/exported PNG. Keep them tall,
  flat-topped or antenna-topped, in a **dark near-black body** (`#0d0518`). Add a
  1px neon top/side edge and a grid of small lit "window" squares. Export each as
  PNG (transparent, sRGB, Nearest/no-AA to preserve pixel edges).
- **Pixelorama (free, desktop):** ideal for the window-grid look — work at a small
  canvas (e.g. 64×256), enable the pixel grid, place windows on a lattice, and use
  indexed palette swatches so recoloring per-zone is one palette swap. Export a
  sprite sheet of 6–10 building variants per layer.
- **Palette to reuse (matches the web build):** bodies `#0d0518`; sky `#0a0420 →
  #2a0a3a → #3a1050` with a `#c0208a` horizon glow; window/accent neons cyan
  `#00e5ff`, magenta `#ff2bd6`, hot-pink `#ff4d8d`, purple `#9945ff`, teal
  `#00ffcc`, amber `#ffb020`. Bias each depth layer toward 1–2 hues so it reads
  cohesive, not rainbow.
- **Play with it fast:** the quickest iteration loop is not Godot — it is a
  scratch HTML canvas or Pixelorama's live preview. Tweak building width/height
  ranges, window density (~40–60% lit), and per-layer alpha (far ~0.42, near
  ~0.9) until it feels right, *then* bring the numbers into Godot.

Two viable pipelines in Godot:

1. **Texture pipeline** — import the painted building PNGs and place/scroll them
   (best if you want hand-drawn detail). Use Sec 4's ParallaxBackground.
2. **Fully procedural** — draw buildings at runtime with `_draw()` so no art
   assets are needed (direct port of the web generator). Covered below.

### 16b. Fully-procedural skyline in Godot 4

Mirror the web engine: one `Node2D` per depth layer with a custom `_draw()`, plus
a `ParallaxBackground` (or manual offset) for scroll. Generate geometry **once**
in `_ready()`; only advance a scroll offset and cheap flicker per frame.

```gdscript
# scripts/skyline_layer.gd  — attach to a Node2D; one instance per depth band
extends Node2D

@export var speed: float = 30.0          # px/sec; far=6, mid=14, near=30
@export var alpha: float = 0.9            # far=0.42, mid=0.62, near=0.9
@export var accents: Array[Color] = [Color("00e5ff"), Color("ff2bd6")]
@export var window_chance: float = 0.6
@export var height_range := Vector2(0.4, 0.78)
@export var width_range := Vector2(80, 170)

var _buildings: Array = []
var _strip_width: float = 0.0
var _offset: float = 0.0
var _t: float = 0.0
const BODY := Color("0d0518")

func _ready() -> void:
    var vp := get_viewport_rect().size
    var sky_h := vp.y * 0.78
    var x := 0.0
    while x < vp.x + width_range.y * 2.0:
        _buildings.append(_make_building(x, sky_h))
        x += _buildings[-1].w + randf_range(16, 40)
    _strip_width = x

func _make_building(x: float, sky_h: float) -> Dictionary:
    var w := randf_range(width_range.x, width_range.y)
    var h := sky_h * randf_range(height_range.x, height_range.y)
    var accent: Color = accents[randi() % accents.size()]
    var windows := []
    var ws := 5.0            # window size px
    var gap := 4.0
    var cols := int((w - 12.0) / (ws + gap))
    var rows := int((h - 12.0) / (ws + gap))
    for r in rows:
        for c in cols:
            if randf() > window_chance: continue
            windows.append({
                "pos": Vector2(6 + c * (ws + gap), 6 + r * (ws + gap)),
                "col": accent if randf() < 0.7 else accents[randi() % accents.size()],
                "flicker": randf() < 0.12,
                "phase": randf() * TAU,
            })
    return {"x": x, "w": w, "h": h, "top": sky_h - h, "accent": accent, "windows": windows, "ws": ws}

func _process(delta: float) -> void:
    _t += delta
    _offset = fmod(_offset + speed * delta, _strip_width)
    queue_redraw()

func _draw() -> void:
    var vp := get_viewport_rect().size
    for b in _buildings:
        var bx: float = fmod(b.x - _offset, _strip_width)
        if bx < 0: bx += _strip_width
        if bx > vp.x: bx -= _strip_width
        if bx + b.w < 0 or bx > vp.x: continue
        # silhouette body
        draw_rect(Rect2(bx, b.top, b.w, b.h), Color(BODY, alpha))
        # neon top + left edge
        var edge := Color(b.accent, alpha)
        draw_line(Vector2(bx, b.top), Vector2(bx + b.w, b.top), edge, 2.0)
        draw_line(Vector2(bx, b.top), Vector2(bx, b.top + b.h), edge, 1.0)
        # lit windows (cheap flicker)
        for wdw in b.windows:
            var a := alpha
            if wdw.flicker:
                a *= 0.5 + 0.5 * sin(_t * 2.0 + wdw.phase)
            draw_rect(Rect2(bx + wdw.pos.x, b.top + wdw.pos.y, b.ws, b.ws), Color(wdw.col, a))
```

Scene tree:
```
SkylineRoot (CanvasLayer, layer = -1)   # behind gameplay
  SkyGradient (ColorRect + shader, or TextureRect)
  Moon (Sprite2D, Add blend)
  Stars (Node2D _draw twinkle, or GPUParticles2D)
  FarLayer  (skyline_layer.gd: speed 6,  alpha .42, purple/magenta)
  MidLayer  (skyline_layer.gd: speed 14, alpha .62, cyan/purple)
  NearLayer (skyline_layer.gd: speed 30, alpha .9,  cyan/magenta/amber)
  WaterReflection (Node2D: re-draw NearLayer flipped, clipped, alpha .32, wobble)
  ReadabilityOverlay (ColorRect: vertical dark gradient over the mid band)
```

Notes for parity with the web build:
- **Readability overlay is essential.** Dim the vertical middle band (~0.5 alpha)
  so the neon bike/particles pop. Without it the city fights the foreground.
- **Water reflection** = redraw the near layer with `draw_set_transform` scaled
  `Vector2(1, -1)` about the waterline, clipped to the water rect, alpha ~0.32,
  plus a small `sin(t)` horizontal wobble and 1px scanline breaks.
- **Sky/moon/stars** generate once; only the moon drifts and stars twinkle.
- Keep all randomness in `_ready()`/generation — never call `randf()` inside
  `_draw()`, or the city will shimmer every frame.
- On low-end/mobile, drop the near-layer glow and cap star count; the window
  `draw_rect` calls are the main cost.
