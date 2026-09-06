# NEON DRIFT — Procreate Asset Guide (iPad)

Everything you need to draw for both the browser prototype (optional) and the Godot 4 port. Start with the bike — that is the most visible asset. Everything else can wait.

---

## Before You Start

**Brush recommendations:**
- Outlines / neon lines: `Inking → Syrup` or `Inking → Studio Pen` (hard edge, no texture)
- Glow blobs: `Airbrushing → Soft Brush` (for blurred bloom layers)
- Detail: `Technical → Fine Tip`

**StreamLine:** Set to 25–40% on all line brushes for smooth curves without jitter.

**Color palette (save as a Procreate palette):**
```
#050010  Deep void (background)
#0d0020  Platform / body fill
#9945ff  Neon purple (primary platform edge)
#00ffff  Cyan neon (bike, primary glow)
#ff00cc  Magenta neon (combo, accent)
#ff3300  Danger orange (drones)
#ff0033  Laser red (laser wall)
#ffff00  Score highlight
#ffffff  Lens flare, hot spot
```

---

## Asset 1: Hover-Bike (3 frames)

**Canvas:** 512 × 256 px, 144 dpi, transparent background, sRGB

The bike is the most important asset. Draw it as a sleek low-profile sci-fi shape — no wheels touching the ground (it hovers). Think F-Zero / Tron lightcycle silhouette.

### Layer stack (bottom to top)

| Layer | Name | Blend | What to draw |
|---|---|---|---|
| 1 | Silhouette | Normal | Flat filled shape in `#0d0020`. Elongated chassis, swept fairings, tapered nose, blunt rear with exhaust nozzle. No tiny details — bold readable shape. |
| 2 | Neon Lines | Add | 2–3px cyan `#00ffff` lines tracing the outer edges of the chassis, a central spine stripe, and the cockpit windshield outline. Use StreamLine. |
| 3 | Glow Bloom | Add | Duplicate "Neon Lines" → Gaussian blur (radius 12px). Reduces opacity to 60–70%. This is the bloom halo. |
| 4 | Cockpit | Normal | Small windshield polygon in semi-transparent `#220044`. Add a `#ffffff` 1px glint dot at top corner. |
| 5 | Exhaust | Add | Rear nozzle: small radial gradient from `#00ffff` center → `#ff00cc` edge. Use the soft airbrush, 30px brush size. |
| 6 | Wheel Glow | Add | Two small circular glows below the chassis where the hover-field would be. Soft airbrush, `#9945ff`, 40px, ~40% opacity. |

### Three frames to export

- **`bike_idle.png`** — horizontal, level pose. Layer stack as above.
- **`bike_lean_fwd.png`** — rotate entire bike group -15°. Nose dips forward. Use for landing / accelerating.
- **`bike_lean_back.png`** — rotate +15°. Nose rises. Use for boost / climbing.

**Export each:** Layers panel → flatten → Share → PNG (no background). Name exactly as above.

---

## Asset 2: Rooftop Platform Tiles (3 pieces)

**Canvas per tile:** 256 × 128 px, transparent background

Draw 3 tiles so Godot can use them as a `NinePatchRect` (L cap + tiling middle + R cap).

### `platform_left.png` (256 × 128 px)

| Layer | Blend | Content |
|---|---|---|
| Base | Normal | Dark rectangle `#0d0020` filling ~right 75% of canvas. Left side has a slightly angled overhang corner. |
| Top Edge | Add | Bright `#9945ff` line, 2px, along the entire top surface. |
| Side Detail | Normal | 2–3 faint horizontal scan-lines on the front face, `#220044`, ~30% opacity. |
| Top Glow | Add | Soft airbrush smear along top edge, `#9945ff`, 60px brush, ~25% opacity. Gives the landing surface a glow. |

### `platform_mid.png` (256 × 128 px)

Same layers as left, but perfectly rectangular with no end caps. **Make sure the left and right edges of this tile match exactly** so it tiles seamlessly.

Check tiling: duplicate the canvas, place copies side by side, zoom in to verify the top edge line is continuous.

### `platform_right.png` (256 × 128 px)

Mirror of `platform_left`. The right side gets the angled overhang.

---

## Asset 3: City Spire Sheet (Background)

**Canvas:** 2048 × 512 px, transparent background

Draw 6–8 different building silhouettes side by side on one sheet. Godot (and Three.js) will split them or tile the whole sheet as a parallax background.

### Technique

**Left and right canvas edges must match** for seamless tiling. Sketch a building that starts at the right edge and continues off the left edge — this ensures the repeat is invisible.

| Layer | Blend | Content |
|---|---|---|
| Silhouettes | Normal | Pure black `#000000` building outlines. Vary heights: some low (150px), some tall (480px). Mix box shapes with stepped tops (setbacks). No windows yet. |
| Window Grids | Normal | Tiny 3×3 px dots arranged in grids on building faces. Color: `#220044`, ~40% opacity. Use a custom brush or stamp pattern. |
| Antenna Glows | Add | Small `#00ffff` or `#cc00cc` glow circles at rooftop tips and antenna points. Soft airbrush, 20px, full opacity. |
| Edge Lines | Add | 1px colored outlines along the top edges of spires only (not the bottom). `#6600cc` or `#00cccc`. |

---

## Asset 4: Ad-Drone (Obstacle)

**Canvas:** 256 × 256 px, transparent background

A surveillance drone that floats mid-air. Orange danger coloring.

| Layer | Blend | Content |
|---|---|---|
| Body | Normal | Octagonal/boxy shape, center-canvas, `#0d0005` fill. Roughly 120×80 px. |
| Edge Lines | Add | `#ff3300` edges on all faces, 2px. |
| Lens | Add | Circular "eye" dead center. `#ff6600` radial gradient, 40px diameter. Add a 4px `#ffffff` dot as lens flare. |
| Rotor Discs | Normal | 4 small ovals (30×10 px) at each corner of the body. `#221100` fill, `#ff6600` outline. |
| Glow | Add | Orange blob glow beneath the drone body. Soft airbrush, `#ff3300`, 80px, ~50% opacity. |
| Beam | Separate file | See below. |

Export `drone_body.png` flattened (all layers).

**`drone_beam.png` (64 × 256 px):**
- Single canvas, transparent bg.
- Draw a vertical gradient rectangle: `#ff3300` at top (full opacity) fading to full transparent at bottom.
- This PNG gets scaled vertically in-game to reach the platform below the drone.

---

## Asset 5: Laser Wall Emitter

**Canvas:** 128 × 512 px, transparent background

A tall barrier — red laser beam with small emitter boxes at top and bottom.

| Layer | Blend | Content |
|---|---|---|
| Emitter Top | Normal | Small box (60×30 px) at the top of canvas. `#330010` fill, `#ff0033` edges. |
| Emitter Bottom | Normal | Same box at bottom of canvas. |
| Beam | Add | Thin vertical rectangle connecting the two emitters, centered. 8px wide, `#ff0033`, full height minus the two emitter boxes. |
| Beam Glow | Add | Duplicate beam → Gaussian blur 10px → reduce opacity to 70%. Creates the laser bloom. |
| Warning Lines | Normal | 2 small diagonal `#ff0033` lines pointing into the beam from each side (hazard arrow style). |

Export `laser_wall.png` flattened. In Godot/Three.js, scale this PNG vertically to match the gap height.

---

## Asset 6: Glow Dot Particle Texture

**Canvas:** 64 × 64 px, transparent background

Used as the texture for particle systems. Simple radial gradient.

Steps:
1. New canvas 64×64, transparent.
2. Select all → fill with `#000000` (temporary).
3. Add a new layer above. Use soft airbrush at max size, `#ffffff`, center-canvas, single tap.
4. The result: bright white center, falls off to transparent edge.
5. Delete the black fill layer.
6. Export as `glow_dot.png`.

This texture applied to `THREE.PointsMaterial` and Godot `GPUParticles2D` draw pass gives smooth glow particles.

---

## Asset 7: Speed Line (Trail Texture)

**Canvas:** 64 × 16 px, transparent background

Horizontal motion blur line for speed trail effect.

Steps:
1. New canvas 64×16, transparent.
2. Use soft airbrush, `#ffffff`, set to 12px height, draw one horizontal stroke across the full width.
3. It should be bright center, fading to transparent at left and right ends.
4. Export as `speedline.png`.

---

## Asset 8: UI Score Panel

**Canvas:** 256 × 64 px, transparent background

Used as a `NinePatchRect` in Godot (mark 24px corners as fixed; middle stretches).

| Layer | Blend | Content |
|---|---|---|
| Background | Normal | Rounded rectangle, `#000000` fill, 40–50% opacity (use alpha slider on layer). |
| Border | Normal | 1px `#00ffff` line along top edge only. |
| Corner Glow | Add | Tiny soft-airbrush dots at top-left and top-right corners, `#9945ff`, 20px. |

Export `panel_score.png`. In Godot: Inspector → NinePatchRect → set Patch Margin left/right/top/bottom = 24.

---

## Asset 9: Combo Multiplier Badge Ring

**Canvas:** 128 × 128 px, transparent background

Only the ring — text goes in dynamically (Godot Label / HTML text).

Steps:
1. New canvas 128×128, transparent.
2. Draw a circle ring: outer radius 58px, inner radius 44px. `#ff00cc` fill.
3. Add glow: duplicate ring layer → Gaussian blur 8px → set to Add blend, 70% opacity.
4. Center must be fully transparent (the hole where the text renders through).
5. Export `combo_badge_ring.png`.

---

## Export Checklist

Before exporting each asset, verify:

- [ ] Background is **transparent** (checkerboard visible behind art)
- [ ] Canvas color mode: **sRGB**
- [ ] Export format: **PNG**
- [ ] File named exactly as listed (Godot is case-sensitive on some platforms)

### Naming reference

| File | Canvas Size |
|---|---|
| `bike_idle.png` | 512 × 256 |
| `bike_lean_fwd.png` | 512 × 256 |
| `bike_lean_back.png` | 512 × 256 |
| `platform_left.png` | 256 × 128 |
| `platform_mid.png` | 256 × 128 |
| `platform_right.png` | 256 × 128 |
| `city_spires.png` | 2048 × 512 |
| `drone_body.png` | 256 × 256 |
| `drone_beam.png` | 64 × 256 |
| `laser_wall.png` | 128 × 512 |
| `glow_dot.png` | 64 × 64 |
| `speedline.png` | 64 × 16 |
| `panel_score.png` | 256 × 64 |
| `combo_badge_ring.png` | 128 × 128 |

---

## Transfer to Mac

Fastest: Procreate `Share → PNG` → AirDrop to Mac → drop into `~/Code/NeonDrift/assets/sprites/`.

For Godot: drop the same folder into `res://assets/sprites/`. Godot auto-imports on drop.

For Three.js: load with `THREE.TextureLoader` and assign to `SpriteMaterial` or `PointsMaterial`. The browser prototype works fine without these textures — all geometry is procedural. Add them in a second pass once the game feels right.
