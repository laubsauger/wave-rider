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
- V20: curvature speed-scaled: implied lateral accel k·avgSpeed² ≤ ~90 m/s² for p95 of samples → curves rideable @ design speed.
- V21: post chain color stages operate on rgb (vec3) only; outputNode reassembles `vec4(rgb, 1)`. ⊥ vec4 color math through `PostProcessing.outputNode` — alpha warp kills WebGPU pipeline SILENT (no console error). Post edits → verify visually @ FX>0.

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
T24|x|audio v2: detect drops, breakdowns, energy shifts → `features.events`|C5,V16
T25|x|track gen v2: real elevation drama, crest jumps @ drops, glide sections @ breakdowns, width ↑|V16,V3
T26|x|airtime physics: airborne over crests, gravity, landing impact, reduced air control|V16,V5
T27|x|input feel: steer attack/release ramp, slower accel spool, harsher walls|B7,B8
T28|x|lean from steer only|V18,B6
T29|x|ship v2: arrow silhouette, detail greebles, clearcoat materials, NPC variants|C11
T30|x|exhaust v2: TSL shader ribbon — white core → accent, length fade, noise flicker|C11
T31|x|environment: grid floor, ridge silhouettes, per-section palettes on rails/pads/scenery, shadows (high tier)|V19,C11,C7
T32|x|NPC collisions: player↔npc energy transfer, lateral shove, shake|V17,V15
T33|x|speed fx: warp streaks @ high v, boost tunnel feel|C11,V10
T34|x|menu v3: waveform card backgrounds, user song library (bpm/duration), spacing polish|I.ui
T35|x|race countdown 3-2-1-GO: sim+music locked until GO|I.ui
T36|x|feel pass 2: slim pod-racer ship, track width ↑↑, curvature drift ↑ (! counter-steer), visible yaw/lean ↑, jumps dialed gentler|C11,V18
T37|x|npc exhaust plumes, per-npc accent color|C11
T38|x|track readability: curvature speed-scaled (V20), per-section elevation trends → crossings separate vertically|V20,V3
T39|x|music coupling 2: onset beat spikes → rails/pads/grid/streaks; section palette → fog/sky/road stripes @ runtime|V19,V3
T40|x|speed fx scale-up: streaks earlier+longer, speed lines earlier, beat-boosted|V10,C11
T41|x|ship v3: 3 hull variants (dart/talon/manta), npc variant = i%3, more greebles|C11
T42|x|track furniture: overhead beat-gates, curve chevrons, finish gate|C11,V19
T43|x|tunnels: breakdown/glide sections → rib tunnels, beat-lit|V16,C11
T44|x|post v2: bloom ↑, radial motion blur ∝ speed+boost (TSL)|V10,C7
T45|x|feel v3: camera accel pull + fov surge, speed-scaled hover bob|C11
T46|x|start: 2-column grid (no pileup), road double-sided (no under-track view @ launch)|V17
T47|x|real steering: outward drift ∝ k·v² meaningful → ⊥ auto-ride, must steer curves|V18,B12
T48|x|HUD minimap: top-down track path + live dots (player accent + npc colors)|V6,V13
T49|x|minimap v2: bigger, oblique 2.5D projection, ground-shadow ↔ path gap = altitude, elevation tint|V6
T50|x|exhaust smoothing: fixed-dt multi-emit + interpolation, ⊥ frame-paced stutter|C11
T51|x|carve feel: nose-in yaw ↑ (front points around corner), roll ↓ (no twist), camera look-into-corner + roll ↑|V18
T52|x|collisions v2: impulse once per contact (cooldown), gradual separation, rear slows / front pushed|V17,B13
T53|x|engine braking: off-throttle drag ↑ → coast stop ~seconds not minutes|B14
T54|x|menu showcase: 3 staggered ship variants, key+rim+fill lighting|C11
T55|x|start grid spacing ↑ (rows 14m, cols ±5m)|V17
T56|x|fix nose yaw sign (inverted), gain ↓, carve assist: steering w/ curve cuts drift 35%|V18,B15
T57|x|audio channel separation: beat→gates+pads, energy→rails/sky/rings, centroid→grid/chevrons/stars|V3,V19
T58|x|gate pass feedback: flash + HUD kick when player threads a gate|C11
T59|x|ship v4: lathed faceted fuselage, armor plates, antenna, underglow, decal stripes|C11
T60|x|corkscrews: track roll frame transport, barrel-roll sections @ onset-dense high energy|V1,C11
T61|x|fov surge ↑ @ top speed|C11
T62|x|full loops + GLTF-grade hulls → next session (quaternion course walk; ROADMAP)|—
T63|x|camera steering damping: cubic response, slow-filtered, speed-scaled — pivots on strong/slow only|C11
T64|x|gate wave: per-gate colors restored, beat flash radiates from player (proximity falloff), ⊥ uniform white blink|V19,C11
T65|x|traction sim: lateral velocity state w/ grip convergence, airbrakes bite; banked corners (roll ∝ k); bank → grip ↑|V18,V20
T66|x|ship v5: WipEout wedge — flat delta planform extrude, chamfered, embedded engine block, twin glow slots|C11
T67|x|HUD v3: waveform progress bar, track name+duration @ minimap, speed/boost → top-right, inset from corners|V6
T68|x|bundled mp3 lazy: ⊥ eager 35MB; meta fetch on hover intent only|C10
T69|x|cockpit cam → ahead of canopy; nose vapor wisps @ high power|C11,V7
T70|x|race ends @ song end: rank by distance (DNF placing)|V2,V13
T71|x|steer fight ↓ (drift 0.5→0.38); bank sign FLIPPED (was anti-camber, B17); corkscrew spawn loosened|V20,B17
T72|x|boost burst: expanding shockwave ring @ pad hit + speedo pop|C11,V10
T73|x|start zone v2: gantry arch @ line, deck restyled (⊥ weird band)|C11
T74|x|fix NaN boundingSphere spam: exhaust skips bounding computation (frustumCulled off)|B18
T75|x|track-setup screen wired by user scaffold (solo/multi); ghost option pending|—
T76|x|MP actually visible: NetworkShip reads live source() per frame + dead-reckoning; POS/minimap rank vs opponent|V13,B19
T77|x|track parts variety: speedway (1.6× wide, boost rows) + ridge (0.6×, no rails) segments, width-aware mesh/physics|V3,V20
T78|x|falloff: rail-less edges → plunge + respawn @ centerline (v×0.4)|V5
T79|x|wreck crashes: closing speed >55 m/s → both slammed, shockwave + max shake|V17
T80|x|read: exhaust 38pts longer/brighter, slimmer tail planform|C11
T81|x|start apron 240m flush deck (⊥ cutoff band)|C11
T82|x|now-playing strip: 14-bar live spectrum (energy body, centroid lobe, beat kick) + title + time/total|V6,T57
T83|x|LCARS speed/boost: text-8xl black, big rounded pills, rounded-pill block|C11,V6
T84|x|MP heartbeat → setInterval (survives occluded tab), ⊥ WAITING deadlock|B20
T85|x|progress waveform: 96 bars, h ↑, perceptual pow(0.45) curve — quiet structure readable|V6
T86|x|host survives peer drop: conn close → back to 'hosting', join id stays valid|B21
T87|x|join failures surfaced in lobby (peer-unavailable → stale-link message)|B21
T88|x|MP start handshake: joiner scene announces lobby_ready (300ms), host arbitrates race_start, both launch ±300ms; download/analyze status both ways|B22
T89|x|SFX: countdown digit beeps + GO chord, synth engine loop (pitch∝v, filter∝thrust, boost growl) — zero assets|C11
T90|x|boost pads → triple chevron arrows (extruded, flat, section palette) — ⊥ cheap box|C11,V19
T91|x|opponent/ghost beacon scales w/ camera distance (1.4×→14×)|C11
T92|x|wallride segments: sustained ~60° bank + matching curve @ onset-dense high energy|V3,V20
T93|x|pregen meta sidecars: scripts/gen-meta.ts → audio/*.meta.json (waveform/duration/bpm/mood/intensity) committed; cards instant, 0 mp3 bytes on load|C10
T94|x|track info chips (bpm/mood/intensity) wherever tracks listed|I.ui
T95|x|menu hangar responsive: aspect>1.1 right column, narrow → arc above|C8
T96|x|engine tone: triangle body, detune 14→5, gains ~-45%, ⊥ whine/drone|C11
T97|x|speed panel: gradient fade ⊥ black block, w-fit, height-gated compact; boost chevrons flipped down-track; minimap compact @ short viewports; engine -55%|C11,V6
T98|x|contrast pass: base brightness ∝ SECTION energy (rails/stripes/caps/arches/rings/tunnels) — breakdowns dim, drops slam|V3,C11
T99|x|sky v2: hash-scattered 2-depth stars (⊥ dot-rows), centroid twinkle, 3 nebula glow discs; tunnels palette-tinted ⊥ white|C11
T100|x|now-playing: row flicker OFF (energy-opacity removed), full ARTIST — TITLE|V6
T101|x|trails keep owner color: narrow age-faded white core (0.78–0.99), accent-dominant, brightness cap ↓ ⊥ bloom whiteout|C11
T102|x|photosensitivity warning: one-time ack gate before menu (localStorage), points at FX slider|V10
T103|x|menu backdrop: drifting star shell + breathing nebula disc ⊥ pure black; now-playing font ↓|C11
T104|x|AAA fidelity arc → ROADMAP R9a–R9g (GLTF hulls, loops, post polish, env reflections, sparks, biomes, surface detail)|—
T105|x|glass road: black glass deck (theme diffuse ↓↓, reflective, slight transparency), neon highlights only; opacity ↑ w/ section energy; ONE pattern — lateral stripes stay, center dash + conduits + panel bump OUT|C11,V3
T106|x|post v4: grain seed fix (B25 static streaks) + amplitude ↓, chromatic aberration ∝ speed, per-theme shadow tint REMOVED (too much), DoF deferred|V10,V21
T107|x|terrain floor: low-res grid ribbon follows track path + elevation (y−85), ⊥ flat plane @ fixed height through world|C11
T108|x|start apron matches glass road — ⊥ pale spawn slab|C11
T109|x|ship v6: wing tips narrowed (chonk ↓), tail fins OUT, cockpit cam @ canopy front + hull hidden in cockpit (⊥ view obstruction)|C11,V7
T110|x|screen backdrops: star/grid scene behind track-setup, lobbies, analyzing — ⊥ full-black menus anywhere|C11
T111|x|warp streaks v2: RESTORED + polished (thinner, sparser, subtler, later onset) — T104 removal was wrong read of feedback (user meant grain)|C11,V10
T112|x|collision vertical gate: airborne ship passes OVER grounded (Δair > ship height ⊥ contact); impulse softened (clunky)|V17
T113|x|engine sound = music: song gain 0.5 floor → 1.0 w/ throttle + speed headroom; synth engine loop OUT|C11,V9
T114|x|track drama ↑: elevation amplitude ↑, wallride/corkscrew/loop spawn windows loosened — banked turns + inversions actually show up|V3,V16,V20

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
B10|2026-06-10|curvature ranges absolute → @ 150+ m/s lateral demand k·v² ≈ 300 m/s², unsteerable, wall-grind fest|V20
B11|2026-06-10|analysis pipeline `await requestAnimationFrame` → background/occluded tab → rAF suspended → hang @ 5% forever|nextFrame races rAF vs 120ms timeout
B12|2026-06-10|drift factor 0.006 absolute; after V20 k ↓ ~6× → outward drift ≈ 0.2 m/s → thrust-only auto-rides track|V20-aware drift: k·v²·0.5 (T47)
B13|2026-06-10|collision resolved EVERY step while overlapping (velocity swap + 1.3m teleport) → jerk/glitch loop|impulse once per contact + cooldown + gradual separation
B14|2026-06-10|drag 0.05·v only → coast τ=20s, halt ≈ 2min|engine braking: off-throttle drag +0.28·v
B15|2026-06-10|visual yaw applied + after rotateY(π) model flip → nose turns OPPOSITE steer|negate yaw in render (T56)
B17|2026-06-10|bank roll sign: rotate(n,t,+θ) tilts up toward +binormal → -k*170 banked AGAINST corners|+k*170 (T71)
B18|2026-06-10|exhaust computeBoundingSphere each frame on degenerate first-frames → NaN radius console spam|skip: frustumCulled=false needs no sphere
B19|2026-06-10|NetworkShip mount gated on `sim.current.opponent` read @ render (null until effect, no re-render) → opponent NEVER visible; props froze @ mount|source() closure read per frame (T76)
B20|2026-06-10|MP handshake heartbeat in useFrame → backgrounded tab (joiner downloading song) sends nothing → both stuck WAITING|setInterval heartbeat 300ms (T84)
B21|2026-06-10|conn close/error → full disconnect() destroys HOST peer too → join id dead, rejoin insta-fails|dropConn(): host keeps peer, re-enters 'hosting' (T86)
B22|2026-06-10|host startRace() immediately after sending bytes → counts down alone while joiner still transfers+analyzes; flip-on-first-packet ≠ sync|ready handshake + host-arbitrated start (T88)
B23|2026-06-10|post outputNode vec4 s-curve warped alpha → WebGPU pipeline died SILENT: black world, 0 console errors, DOM HUD fine (T104/R9c)|V21
B24|2026-06-10|telemetry.countdown init 0 sits INSIDE GO window (-1,0] → HUD flashed GO on mount before sim wrote 3.8; stale post-race value re-flashed on next mount|init 9 + RaceScene mount reset + READY state >3
B25|2026-06-10|grain hash(seed).toUint() quantizes — seed multipliers below pixel pitch → neighbor px collapse to same hash → horizontal static streaks crawling frame|seed mults ≫ resolution (≈39k/21k) + amplitude ↓ (T106)
