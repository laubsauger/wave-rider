# WAVE RIDER

Anti-gravity racing where **your music is the track**. Drop in any audio file — BPM, energy, drops and breakdowns get analyzed client-side and carved into a neon course. Deterministic: same song, same track, every time.

![menu](docs/menu.jpg)

![race](docs/race.jpg)

- Audio analysis → track generation, no server, no `Math.random` — every twist is seeded from the song
- Drops become jumps. Breakdowns become glide tunnels. Onset-dense peaks spawn corkscrews, loops and wall rides
- WebGPU renderer (three.js + TSL): bloom, depth of field, radial blur, re-entry heat at hyperspeed
- 5 NPC racers, hull energy, wreck explosions
- 1v1 multiplayer over WebRTC — the host sends the song file to the joiner, both race the identical generated track
- Ghost replays shareable as a URL
- Keyboard + touch, quality tiers, mobile landscape

## Run

```sh
npm install
npm run dev
```

Needs a WebGPU browser (Chrome/Edge 113+, Safari 26+). WASD steer/thrust, `S` retro brake, Shift/Space airbrakes, `C` camera, `Esc` pause.

```sh
npm test       # deterministic core suite (analysis, gen, physics)
npm run build  # production bundle
```
