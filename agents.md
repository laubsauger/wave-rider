# wave-rider agent context

Welcome to **wave-rider**, an audio-reactive anti-gravity (AG) racing game with a *WipEout 2097* vibe. 
The core twist is that the track course, look, mood, and flow are generated deterministically from audio analysis (either built-in music or user-provided audio files).

## 🛑 Core Invariants (MUST READ)

When working on this codebase, you MUST adhere to the following constraints (see `SPEC.md` for the full list):

1. **WebGPU ONLY**: The game uses `three.js`'s `WebGPURenderer`. There is NO WebGL fallback. If the browser lacks WebGPU, the game shows an "unsupported" screen. Ensure all shaders and materials are WebGPU compatible (e.g., use Three.js WebGPU nodes/TSL where applicable).
2. **Strict Determinism**: The track generation must be a pure function of the audio features. **NEVER use `Math.random()` in the generation path.** Same audio bytes → same track. Any randomness must use a seeded PRNG based on the audio features.
3. **Fixed Physics Timestep**: Physics simulations use a fixed timestep. Render framerate must not affect simulation results.
4. **Client-Side Only**: All audio analysis (`OfflineAudioContext`) and track generation happens locally in the browser. There is no backend server.
5. **Aesthetics**: The visual direction relies on deep blacks, hard neon glows, and strong speed cues.
6. **Mobile Handling**: Gameplay on mobile requires landscape orientation. Portrait mode shows an overlay blocking gameplay.

## 🛠 Tech Stack
- **Language**: TypeScript
- **Build Tool**: Vite
- **UI Framework**: React
- **3D Rendering**: `three.js` with `@react-three/fiber` (r3f)
- **Styling**: Tailwind CSS

## 📁 Key Documents
- `SPEC.md`: The absolute source of truth for the current state, constraints, invariants, and tasks. Consult this file before making structural changes or fixing bugs. Add bugs to `§B` and task items to `§T`.
- `ROADMAP.md`: Outlines future scope items not yet in the active spec (e.g., gamepad support, lap modes). Promote items to the spec before implementing.

## 🎮 Gameplay Mechanics
- **Controls**: Keyboard (Arrows/WASD + Shift/Space) and Touch (Left/Right zones).
- **Audio Sync**: Music playback is synced tightly with the race. The track ends exactly when the song ends (point-to-point race mode).
- **NPCs**: NPC behavior is deterministic, seeded from the track and NPC index.
- **Physics**: Real steering (drift vs. grip), engine braking, ship banking into corners based on steering input, airtime and jumps linked to song drops/breakdowns.

When making modifications, carefully read `SPEC.md`'s invariant (`§V`) section to ensure you don't violate the core logic. Keep performance at 60fps for desktop and ensure UI elements respect the 16:9 safe area anchoring.
