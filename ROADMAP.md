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
