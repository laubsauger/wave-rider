# wave-rider

## §G goal

Browser AG racing game, WipEout 2097 vibe. Twist: track course, look, mood, flow generated deterministically from audio analysis (built-in music | user audio file). Racing feel ! satisfying — dopamine first.

## §C constraints

- C1: stack: TypeScript, Vite, React, react-three-fiber, three.js `WebGPURenderer`, Tailwind.
- C2: render: WebGPU only. ⊥ WebGL fallback. No WebGPU → "unsupported browser" screen.
- C3: targets: desktop & mobile browser. Mobile → landscape only.
- C4: input: keyboard & touch, both full control. Gamepad → ROADMAP.md.
- C5: determinism: same audio bytes → same track. No `Math.random` in gen path; all randomness seeded from audio features.
- C6: audio analysis client-side (Web Audio `OfflineAudioContext`). No server.
- C7: perf: 60fps desktop, ≥30fps mid mobile. Quality tiers.
- C8: aspect: 16:9 → 21:9 graceful; HUD safe-area anchored, no distortion.
- C9: physics fixed timestep, render decoupled.
- C10: bundled music = user-owned files in `audio/` (no licensing risk). Synth songs stay as DEBUG entries (gen debugging).
- C11: visual direction: deep blacks + hard neon glow, strong speed cues. Bland ⊥.

## §I interfaces

- ui: route `/` → menu: built-in track list | file picker.
- input: audio file: mp3, wav, ogg, m4a → decode via `decodeAudioData`.
- fn: `analyzeAudio(buffer: AudioBuffer) → AudioFeatures` {bpm, energy[], sections[], onsets[], spectralCentroid[], mood}
- fn: `generateTrack(features: AudioFeatures) → TrackData` {spline, segments[], theme, hazards[]}
- ctl keyboard: arrows/WASD steer+thrust, `Shift`/`Space` airbrakes, `C` camera toggle, `Esc` pause.
- ctl touch: left zone steer, right zone thrust/brake buttons, camera button.

## §V invariants

- V1: ∀ audio input → identical bytes → identical `TrackData`. Gen pure fn of features.
- V2: race mode point-to-point: track length ≅ song duration, finish line @ song end. Laps/infinite → ROADMAP.md.
- V3: mood/tempo → track params: high bpm/energy → fast straights, tight chicanes; calm → flowing curves. Mapping documented & deterministic.
- V4: mobile portrait → gameplay blocked, rotate overlay shown. Landscape → play.
- V5: physics step fixed (e.g. 1/120s accumulator). Render fps ≠ affect sim result.
- V6: ∀ viewport aspect ∈ [4:3, 21:9] → no stretched render, HUD elements inside safe area.
- V7: camera modes: chase (3rd) & cockpit (1st), toggle anytime, state preserved.
- V8: ⊥ unhandled `Math.random` in track gen path.
- V9: music playback synced to race: track position ↔ song time drift ≤ 250ms.
- V10: screenshake/post fx intensity user-scalable, 0 → fully off (accessibility).
- V11: ∀ builtin song → analyzed bpm ∈ [0.92, 1.08] × spec bpm. Autocorr ! prefer faster octave when corr(lag/2) ≥ 0.72 × best.
- V12: ∀ sim step → ship v ≤ 1.1 × vmax(boost). Boost chains ⊥ runaway.
- V13: race position = 1 + |{racer: racer.s > player.s}|, updates live, shown in HUD.
- V14: ship banks INTO corner: steer/curve right → right side dips. Lean sign documented in `computeLean`.
- V15: NPC sim deterministic: seeded from track.seed + index, same fixed timestep as player (V5).
- V16: ∃ drop event in song → ∃ crest+descent in track → ship @ speed gains airtime (≥0.25s), lands clean (no clip).
- V17: ship collisions: deterministic, energy transfer ⊥ create speed (Σv after ≤ Σv before + ε), both stay in walls.
- V18: lean ∝ user steer input only. Track curvature ⊥ auto-lean ship. (amends V14)
- V19: ∀ adjacent sections w/ Δbrightness ≥ 0.1 → distinct rail/pad/scenery palette (visual development).

## §T tasks

id|status|task|cites
T1|x|scaffold: Vite+React+TS+Tailwind+r3f+three WebGPURenderer, WebGPU detect → unsupported screen, render spinning ship placeholder|C1,C2
T2|x|audio pipeline: decode, `analyzeAudio` → bpm, energy, sections, onsets, mood|I.analyzeAudio,C5,C6
T3|x|`generateTrack`: features → spline course, segments map song sections, seeded PRNG|V1,V2,V3,V8
T4|x|track mesh gen: extrude road from spline, walls, boost pads, theme materials|T3,C7
T5|x|ship physics: hover, steer, thrust, airbrakes, wall collision, fixed timestep|V5,C9,V12
T6|x|input: keyboard + touch zones, landscape lock + portrait overlay|C4,V4,I.ctl
T7|x|cameras: chase + cockpit, speed FOV, screenshake|V7,V10
T8|x|HUD: speed, progress, time, futuristic style, safe-area anchored|V6,C8
T9|x|music playback + race sync, finish @ song end|V9,V2
T10|x|VFX: bloom, speed lines, wall-hit vignette, boost flash|V10,C7
T11|x|menu flow: track select, file upload, analysis progress, results screen|I.ui
T12|x|built-in music: 3 synthesized original songs (zero licensing) + per-mood themes|I.ui,V11
T13|x|quality tiers (dpr, sample ds, star count, bloom-off-low)|C7
T14|x|polish: audio-reactive rail pulse + HUD eq, wall-grind feel, boost chains capped|V3,V10,V12
T15|x|bundled music: `audio/*.mp3` as primary tracks, synth songs → DEBUG section|C10
T16|x|camera feel: tighter tether, both cams roll with ship, fix banking sign|V14,B5
T17|x|ship exhaust: engine trails (ribbon) + flame glow scaled by thrust/boost|C11
T18|x|trackside geometry: instanced neon pylons, arches @ section bounds, holo rings|C11,V8
T19|x|HUD v2: prominent fill bar, segmented speed/boost bar, POS display|V6,V13
T20|x|NPC racers: 5 ships, per-NPC skill (pace, lines, wobble), live position rank|V13,V15
T21|x|audio-reactive pass: both rails + pads pulse, sky/fog beat flash, beat lights|V3,V10
T22|x|speed feel: road stripe shader (TSL), center dash, scrolling glow lines|C11,C7
T23|x|menu v2: centered composition, song cards, settings row, controls hint|C11
T24|.|audio v2: detect drops, breakdowns, energy shifts → `features.events`|C5,V16
T25|.|track gen v2: real elevation drama, crest jumps @ drops, glide sections @ breakdowns, width ↑|V16,V3
T26|.|airtime physics: airborne over crests, gravity, landing impact, reduced air control|V16,V5
T27|.|input feel: steer attack/release ramp, slower accel spool, harsher walls|B7,B8
T28|.|lean from steer only|V18,B6
T29|.|ship v2: arrow silhouette, detail greebles, clearcoat materials, NPC variants|C11
T30|.|exhaust v2: TSL shader ribbon — white core → accent, length fade, noise flicker|C11
T31|.|environment: grid floor, ridge silhouettes, per-section palettes on rails/pads/scenery, shadows (high tier)|V19,C11,C7
T32|.|NPC collisions: player↔npc energy transfer, lateral shove, shake|V17,V15
T33|.|speed fx: warp streaks @ high v, boost tunnel feel|C11,V10
T34|.|menu v3: waveform card backgrounds, user song library (bpm/duration), spacing polish|I.ui
T35|.|race countdown 3-2-1-GO: sim+music locked until GO|I.ui
T36|.|feel pass 2: slim pod-racer ship, track width ↑↑, curvature drift ↑ (! counter-steer), visible yaw/lean ↑, jumps dialed gentler|C11,V18

## §B bugs

id|date|cause|fix
B1|2026-06-10|bpm autocorr picked 2× beat period (octave-low, HYPERGLIDE 63 vs 126) → wrong design speed & mood|V11
B2|2026-06-10|wall clamp applied speed multiplier per physics step @ 120Hz → grinding wall ≈ full stop|`onWall` latch: impact once, light friction while grinding
B3|2026-06-10|boost accel flat +90 m/s², only drag opposed → chained pads → 1827 kph runaway|V12
B4|2026-06-10|chase cam `lerp(dt*5.5)` unbounded lag → @ high v ship ~90m ahead, off-screen|hard tether: cam ≤ 5m from desired pos
B5|2026-06-10|ship roll sign inverted after `rotateY(π)` flip → leans OUT of corners|V14
B6|2026-06-10|lean coupled to track curvature → ship leans w/o steer input, feels on-rails|V18
B7|2026-06-10|keyboard steer 0→1 instant @ 120Hz → single tap = wall slam|steer attack/release ramp in ShipState
B8|2026-06-10|accel = avgSpeed*0.55 → near-instant top speed, no spool feel|accel curve (1-(v/vmax)^1.5), accel0 ↓
B9|2026-06-10|event detect: pure percentile thr fails when quiet ≈ half of song (thr inside quiet cluster)|range-based thr (p15..p85 band)
