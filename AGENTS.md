# Neon Drift — future enhancement handoff

## Status and scope

The experimental implementation from the November 13, 2026 session was rejected and completely reverted. This commit contains documentation only. Keep the existing game intact. Do not treat approval of that experiment as approval to reimplement its mechanics.

The user wants another implementation pass with Claude. Make small, reviewable additions to the existing game and preserve its feel. Do not replace the core game with a different flight system.

## What the user wants to accomplish

- Remove the annoying red box instant-kill hazard. Identify the specific hazard in the running game before changing collision behavior; do not use this request as permission to remove every hazard or mechanic.
- Add more immersive, exciting features and finer visual components while preserving the current visual fidelity, neon wireframe style, cyan/magenta/purple palette, bike silhouette, skyline depth, particles and water reflections.
- Add increasingly fun and complex navigation with an intuitive Jetpack Joyride influence, without loot mechanics. The reference is a direction for accessibility and pacing, not permission to replace existing controls.
- Reward duration spent actually playing, encouraging longer runs and replay. Propose deterministic milestones or optional cosmetic rewards; avoid loot, random drops, currency and power grinding.
- Use Antigravity via the terminal alias `google` for graphic options. Show concrete visual previews before implementing graphics. Confirm the concrete mechanics and level-design proposal before implementing it.

## Preserve the mechanics and terrain variation

The existing game has tap/Space boost, hold-to-glide, release-to-dive, fuel and landing refills, coyote-time grace, aerial flips, landing combos, scoring and camera behavior. Preserve these unless the user explicitly approves a specific change in a new proposal. Do not silently remove them to simplify implementation.

Keep the original rhythm of shorter platforms, varied heights, widths and gaps. Add navigation around that foundation, with readable approaches and recovery stretches. Avoid replacing varied rooftops with long, flat runway chunks or repetitive gate corridors. Any new route must fit the existing movement capabilities and visible collision shapes.

The user rejected the experimental version because it removed established mechanics, lost the older platform variation, introduced excessively long/close platforms, and produced overlapping HUD text. Address these concerns before considering additional scope.

## Approved visual concepts to revisit

The user liked A, B and C transitioning into one another. Preserve a consistent base style and blend district-specific details rather than performing an unrelated art overhaul.

- **A — Precision Skyline:** segmented chassis components, cockpit and vector-vane details, magnetic hover rings, deck ribs, conduit edges/couplers, rooftop antenna clusters, dishes and beacons.
- **B — Stormline Transit:** retain A's detail and add restrained fine rain, deck splashes, distant elevated transit/light ribbons and soft background light shafts.
- **C — Reactor Canopy:** add background turbine housings and rotating impellers, suspended curved conduits, architectural arches and distinct industrial tunnel silhouettes.

Keep background spectacle dimmer than gameplay surfaces and collision edges. Reuse geometry/materials and bound particles and decorative objects. The preview's frame-rate and draw-call claims were estimates, not measurements; validate performance on actual devices instead of promising it.

## Suggested process for the next pass

1. Play and inspect the restored baseline first. Describe the existing mechanics and identify the red box hazard.
2. Propose an incremental mechanics/level-design change with explicit retained behavior and get user confirmation.
3. Generate and show graphic alternatives with Antigravity; agree on concrete detail and transitions before implementation.
4. Implement in small steps and let the user playtest each meaningful change. Keep platform variation and the original movement feel visible throughout.
5. Give HUD elements dedicated layout space: combo, district, timer, landing feedback and route messages must not overlap. Check compact viewports and safe areas.
6. Validate input, collision alignment, reachable terrain, difficulty progression, retries, audio, saved progression and pause/hidden-tab behavior. Duration rewards must exclude inactive time.
7. Publish gameplay changes only after a new explicit user approval. This handoff is not authorization to publish a new game implementation.

## Repositories and release boundary

- Vercel/source checkout: `/Users/kartikeyachaauhan/Desktop/Code/Neon-Drift-Vercel` — origin `Erscheinung/Neon-Drift`.
- Separate public/static checkout: `/Users/kartikeyachaauhan/Desktop/Code/Neon-Drift` — origin `Erscheinung/Neon-Drift-2D`; its existing main-branch workflow publishes GitHub Pages.
- Preserve each checkout's deployment-specific leaderboard adapter. Do not blindly overwrite the public static adapter with the Vercel server-backed version.
- Never copy or commit environment files, tokens, credentials, local configuration or server-only secrets. Sync an explicit list of approved public game/assets files and inspect staged paths before publishing.
- The current instruction is to commit and push only these handoff docs. Game code and deployment workflows must remain unchanged by this documentation update.
