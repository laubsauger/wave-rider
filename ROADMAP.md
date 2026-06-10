# wave-rider roadmap

Future scope. ∉ SPEC.md until promoted. Promote via `/spec amend`.

## input

- R1: gamepad support (Gamepad API): analog steer, triggers thrust/brake, rumble on impact/boost.

## race modes

Current (spec'd): point-to-point — track length ≅ song duration, finish @ song end.

- R2: laps mode: closed-loop circuit gen from song, song loops per lap | lap count from song sections. Classic WipEout structure.
- R3: infinite mode: playlist input → endless track, segments stream-generated per upcoming song, seamless transitions @ song boundaries. Mood shifts between songs → visible biome/theme transitions.

## misc candidates

- R4: ghost replays (deterministic tracks → shareable ghosts per audio hash).
- R5: time-trial leaderboards keyed by audio fingerprint.
- R6: WebGL2 fallback ⊥ planned — WebGPU only stays.

- R7: full vertical loops (quaternion course walk — heading/pitch walk gimbals @ ±90°).
- R8: GLTF-grade ship hulls: panel-line geometry, greeble pass, per-team liveries.

## R9: AAA fidelity session — DONE (T104)
Shipped 2026-06-10: contrast pass (T98), sky v2 (T99), bloom + radial blur (T44), shadows (T31), plus:
- R9a ✓ procedural hull detail — panel lines, plates, greebles, livery slashes (`scene/hull/buildHull.ts`, 2 merged draw calls).
- R9b ✓ full vertical loops — analytic circle walk + per-control-point `ups` carry frames through inversion; arc-aligned attribute mapping (`generate.ts`, `sample.ts`).
- R9c ✓ post polish — filmic s-curve, per-theme shadow grade, vignette, film grain (Effects.tsx; see B23/V21: rgb-only color math).
- R9d ✓ env reflections — procedural equirect `scene.environment`, WebGPU EnvironmentNode verified, tier-gated.
- R9e ✓ sparks — wall-grind shower, airbrake snaps, landing dust (`scene/Sparks.tsx`, V10-scaled).
- R9f ✓ biomes — city canyon / desert monoliths / crystal cavern by mood (Scenery.tsx).
- R9g ✓ surface detail — bump-mapped panel plating + animated energy veins (Track.tsx TSL).
Leftover polish candidates → future arc: loop entry/exit chevron furniture, biome-specific skylines, hand-built GLTF hero hulls.
