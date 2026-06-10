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

## R9: AAA fidelity session (next dedicated arc — pick up here)
Done so far: contrast pass (section-energy lighting floors, T98), sky v2 (hash stars + nebulae, T99), bloom + radial motion blur (T44), shadows (T31).
- R9a: GLTF-grade hulls — panel-line geometry, greeble pass, per-team liveries (= R8/T62). Procedural builder script | hand-built assets.
- R9b: full vertical loops — quaternion course walk (= R7/T62); roll plumbing from T60 corkscrews is the foundation.
- R9c: post-stack polish: vignette, film grain, tone curve, per-theme color grade (TSL nodes in Effects.tsx).
- R9d: env-mapped reflections on hulls (PMREM w/ WebGPURenderer — verify support first).
- R9e: drift/airbrake spark particles, landing dust, wall-grind sparks.
- R9f: environment biomes per mood: city canyon / open desert void / crystal cavern — scenery sets swapped per theme.
- R9g: track surface detail: normal-mapped panels via TSL, animated energy veins.
