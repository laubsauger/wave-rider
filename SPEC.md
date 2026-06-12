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
- ctl keyboard: arrows/WASD steer+thrust, `S`/`↓` retro brake (decel; airborne → sink), `Shift`/`Space` airbrakes, `C` camera toggle, `Esc` pause.
- ctl touch: left zone steer, right zone thrust/brake buttons (drag thrust DOWN = retro brake), camera button.

## §V invariants

- V1: ∀ audio input → identical bytes → identical `TrackData`. Gen pure fn of features.
- V2 (rework 2026-06-11): point-to-point; `avgSpeed` = SKILLED ride pace (boost discipline), ⊥ slow reference. Physics derives: no-boost cruise ≈ 0.75×, ceiling 1.36×+100 (ship.ts). length = avgSpeed × duration → good ride finishes ≅ song end. Laps/infinite → ROADMAP.md.
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
- V20 (rework 2026-06-11): curvature budget = ship CARVE AUTHORITY, ⊥ fixed lateral-accel target: p95 |k| ≤ maxCarveCurvature(0.75·avgSpeed) (ship.ts mirrors drift model). Sharpest peaks (chicane) may exceed → airbrake zones = speed-management skill.
- V21: post chain color stages operate on rgb (vec3) only; outputNode reassembles `vec4(rgb, 1)`. ⊥ vec4 color math through `PostProcessing.outputNode` — alpha warp kills WebGPU pipeline SILENT (no console error). Post edits → verify visually @ FX>0.
- V22: hull ENERGY 0..1: wall/median hits drain ∝ impact + forward speed; ship-ship collision drains BOTH ∝ closing speed (rammer ~1.75× victim, fatal ≥ ~215 m/s closing); grind drains continuous; regen after 2s no-damage grace; 0 → explosion → wreck pause (~1.3s, watchable) → reset 40m back, fresh hull. All resets (fall, loop-miss, explosion) share the wreck path.
- V23: NPCs run stepShip — ONE physics rulebook (vmax, drag, drift, pads, walls, energy). NPC-ness = controller only: steer ff+PD (speed-scaled gains), smoothed throttle ceiling, brake margin ∝ cornerSkill. ⊥ parallel movement model. (V15 determinism unchanged.)
- V24: corners CAMBER ∝ coordinated-turn angle atan(k·vC²/g)·0.55, cap 0.76 rad (curve/chicane/split/glide; wallride keeps bankAbs). Flat = straights/speedways only. Transitions: smoothstep edge windows (~15%) + chicane/split S-flip through flat.
- V25: trackside spawns (pylons, biome) must clear the WHOLE course corridor — spatial-hash check, reject when horizontally within objR+34m AND vertically overlapping a non-own track section. Course crosses its own footprint; own-segment clearance is not enough.
- V26 (amend 2026-06-11): localStorage = COMPACT RECORDS only (settings, recents, acks, track records incl. gzip+base64 ghost frames ~30-60KB) — audio bytes ⊥ localStorage (quota blowup). Song bytes live in session memory | on user's disk via explicit save.
- V27: song identity = STABLE ID (bundled id | synth id | user slug) carried in store.songId through every flow entry. Display strings ("ARTIST — TITLE") ⊥ lookup keys. MP lobby resolves transfer source by id only.
- V28: track records keyed `songId:track.seed` (seed disambiguates same-named files, V1 makes it stable). Leaderboard = FINISHED runs only, top-5 sorted asc; bestGhost = ghost of fastest finished run, replaced ONLY when beaten. Record count LRU-capped (quota).
- V29: RUBBER-BAND — non-elite NPCs modulate target pace ∝ signed gap to player, bounded [-12%, +18%], smooth ramp over ~600m. ELITE tier (top pace) exempt — skill ceiling stays honest. Deterministic given player trace (V15 form preserved, V23 controller-only).
- V30: MP launch sync: host measures RTT (ping/pong), race_start carries delay minus rtt/2 — countdowns aligned ≤ ~rtt/2 jitter (⊥ fixed 400ms latency guess). Joiner retries peer-unavailable ~30s (host may be app-switched sharing the link, B40).

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
T115|x|fall/crash respawn = SETBACK: reset to fall-off point −40m (⊥ keep progress gained while plunging)|V5
T116|x|player accent ≠ theme base color — contrast pick from palette, NPC accent too close → hue-shifted|C11,V13
T117|x|UI glass: smoked-glass panel behind menu + results wrappers; B26 fix: backdrop canvas swallowed results clicks (pointer-events)|C11,I.ui
T118|x|selective glow: start apron matte (⊥ green slab v2), road glass opacity ↓, world grid ⊥ beat flicker (slow section-energy only)|C11,V10
T119|x|music-engine ceiling: full volume @ full throttle + ~250 kph (⊥ vmax-relative starvation)|V9,C11
T120|x|ship polish: outer tail lights re-grown, exhaust ribbon head tapered + aligned w/ flame cones (⊥ disconnected rectangle)|C11
T121|x|furniture elegance: beat-gates + holo rings get dark casings w/ inset emissive — ⊥ 100% raw emissive slabs|C11,V19
T122|x|sponsor boards @ start: 3 floating holo displays (L/R/center) w/ logo + SPONSORED BY, bob + fade-out once passed — ad monetization sketch|C11
T123|x|walls v2: ⊥ flat slab — gradient glass (dense base → clear top), lit top edge in section palette, faint scanlines|C11,V19
T124|x|waveform horizon: far skyline ring = smoothed audio energy bars around the world, drifts w/ song|C11,V3
T125|x|ship finish v2: shinier hull (roughness ↓, env reflections visible, diffuse env cast ↓); quad tail lights — big outers|C11
T126|x|sponsor boards v2: larger, outers pushed wider + tilted inward, fly-in @ READY → lift-off @ GO, soft holo wobble ⊥ strobe; start apron slimmed to road width|C11
T127|x|exhaust unified: cone flames OUT — trail head IS the flame (anchored @ nozzle, hot white head, full width) → one effect that turns with the ship ⊥ detached ribbon|C11
T128|x|start grid v2: slot pads DELETED — thin glowing accent bar per racer slot (player + npc colors)|C11,V13
T129|x|mobile pass: compact menu/setup density (short-viewport), rotate overlay gets title + tap-to-fullscreen, photosensitivity copy short ⊥ cutoff|C3,C8,V4
T130|x|track gen dig 2: banked turns stronger + common (cap 0.42→0.58, gain ↑), wallride/corkscrew/loop spawn ↑↑ — sideways riding actually happens|V3,V20
T131|x|fall keeps momentum (plunge carries forward) + setback respawn; steer authority scales ↓ w/ speed (⊥ hairpin @ 900kph)|V5,V18
T132|x|horizon v2: dual offset rings, slim bars w/ gaps, glow tip caps — layered + subtle ⊥ in-your-face EQ wall|C11,V3
T133|x|boards v3: inward tilt FIXED (sign), descent lands before digits, baseline glow ↑ + shimmer swell|C11
T134|x|tail light pulse: ONE shared material both outers (right one read dead — only left had the pulsing ref)|C11
T135|x|NPC launch ramp: staggered accel first seconds ⊥ GO pileup into player|V15,V17
T136|x|countdown READY/digits/GO get glass chip backdrop ⊥ lost in space|V6,C11
T137|x|DoF: TSL DepthOfFieldNode — focus tracks mid-distance, bokeh ∝ speed, fx-scaled|V10,C7
T138|x|touch hint @ start: left-zone STEER / right-zone THRUST labels, fade after first input|C4,V4
T139|x|skyline v3: per-bar width+color variation (instanceColor gradient), sluggish far ring — ⊥ homogenous flat EQ|C11
T140|x|furniture frames v2: outer casing MATTE black (zero emissive), inset glows w/ beat — gates + rings|C11,V19
T141|x|exhaust flare: nozzle bulge (mach-diamond read), soft leading edge, flicker ↓, accent ↑ vs white|C11
T142|x|global elevation trend: seeded start→end climb/descent (~±200m) — upcoming segments READ|V3
T143|x|feel: outward drift ↓ (0.38→0.31) + yaw response ↑; camera: slower steer filter + roll low-pass (⊥ twitch on micro-inputs)|V18,C11
T144|x|persistent backdrop: ONE canvas across menu/setup/lobbies/analyzing (⊥ swap flicker); menu canvas transparent overlay for ships|C11
T145|x|NPC grid launch: hold formation lanes + row-staggered release (⊥ GO pileup squeeze); top NPCs faster + sharper (real competition)|V15,V17,V13
T146|x|countdown text: soft radial shadow halo ⊥ chunky glass box|C11,V6
T147|x|mobile fit v2: short-viewport alignment top+scroll (⊥ center-cutoff), density ↓↓; rotate→landscape w/o fullscreen → one-tap fullscreen banner|C3,C8
T148|x|DoF refocus: ship + near field SHARP (focus ≈ cam→ish), distance blurs ∝ speed|V10,C11
T149|x|dynamic range pass: audio-reactive brightness floors ↓ + energy² curves (⊥ pegged @ max), horizon EQ colors drift w/ section palette + per-bar shading variation, floor grid toned ↓|V3,V19,C11
T150|x|NPC feel: separation nudges dt-scaled (⊥ 0.3m/step teleport stutter @ 120Hz), exhaust power reads full-throttle|V15,V17,C11
T151|x|track aggression v3: banked curves THE NORM (energy-scaled gain, cap 0.78), wallride gates ↓↓ + longer + sloped — sideways action actually common|V3,V20
T152|x|mobile haptics: vibrate on boost catch / wall hit (impact-scaled) / wreck — fx-gated|C4,V10
T153|x|wall contact v2: orange EMBER spray layer (hot, heavy, short-lived) on top of spark puffs; impact burst + grind stream|C11,V10
T154|x|spectacle gates fixed for REAL songs: corkscrew/loop/wallride energy+onset thresholds ↓ (bundled catalog sits mid-energy → gates never fired); verified on builtin analyzed audio|V3,V16
T155|x|twist-zone entry: airborne into loop/corkscrew → low (≤6.5m) = soft capture (air bleeds over ~0.3s, ⊥ teleport snap); high = crash + reset 30m before zone; glowing capture gate marks every entry|V5,V16,C11
T156|x|retro brake: S/↓ keyboard + thrust-drag-down touch — hard decel on deck, airborne adds SINK (slower + lower)|I.ctl,V5,C4
T157|x|jump→twist-zone conflict: gen forbids corkscrew/loop within 160m after a jump (NITS double offender); capture also forgives steep-descent entries (vy<−6, air<12 → captured)|V3,V16,V5
T158|x|jumps dialed to track scale: shorter segments, gentler crest, shallower dive — hops not ballistic arcs|V16,V3
T159|x|NPC launch v2: off the line WITH the player (accel envelope = player's B8 taper, 0.12s row ripple); pace ↑ to 1.62 top (player must boost to win)|V15,V13
T160|x|track vocabulary v2: corkscrews BOTH chiralities; 'spiral' = long descending hard-banked sweeper (600-900m); 'sbank' = long hard right-bank→left-bank flip (360-560m); curve lengths ↑ across all bands — sustained pieces|V3,V20,V1
T161|x|NPCs catch boost pads: same geometry as player, once each, boost window lifts their target + accel — fair race|V15,V17
T162|x|dynamic vignette: always-on base, tightens w/ speed + boost (tunnel vision); scene-wide brightness BREATHES (ambient + env ride section energy²) ⊥ static average|V10,C11,V3
T163|x|elevation amplitude v3: slope bias ↑, steeper hills/straights — ⊥ flat-on-average course|V3,V16
T164|x|skill ceiling: NPC tail tightened (1.32 floor, VEKTOR stays 1.62 cookie); per-segment width variation (curves 0.78-1.25, straights 0.9-1.4) — line choice matters; rails GONE on ~30% straights, 15% curves, 20% corkscrews|V13,V15,V3,T77,T78
T165|x|TRUE wall rides: ~30% of wallrides go near-VERTICAL (85°, shorter, slimmer) — coordination test on the wall face|V3,V20,V1
T166|x|darkness v2: ambient/env floors ↓↓ (quiet = actually DARK), emissive idle floors trimmed; gate casings get support legs + faint edge tint — integrated structures ⊥ scattered dark frames|C11,V3,V19
T167|x|speed payoff: vignette tunnel ACTUALLY clamps (mask in + max ↑), fov surge ↑, SONIC BOOM @ 93% vmax — shockwave + flash + boom + haptic, re-arms below 85%|V10,C11,V12
T168|x|race feel v4: VEKTOR 1.7 + guaranteed top-2 corner skill (pro tier); drift ↑ 0.36 + carve assist ↓ (turns demand steering); LONG curves run WIDE (1.15-1.6×, room to be wrong) while short stay tight; sonic boom vs BOOSTED vmax (B33: fired on every pad crossing = the blip)|V13,V18,V20,V12
T169|x|HYPERSPEED: vmax → avgSpeed×3+100 (~2000-2600 kph ceiling); drift v² capped @ 320 m/s (ultra speed controllable); base width ↑; RE-ENTRY HEAT veil 1000→2500 kph (orange edge glow + CA ∝ heat); vignette punched visible; sonic boom = VISUAL only (sound out), threshold rides new ceiling|V12,V20,V10,C11
T170|x|boost DISCIPLINE = skill ceiling: quadratic drag drops no-boost cruise ~55% vmax, per-boost punch ↓ (kick 15, window 0.9s, accel 75) — holding near max takes sustained chains; gen recalibrated for hyperspeed: jumps gentler, chicane/sbank curvature ↓, global k budget 50→42, long curves wider (1.25-1.8)|V12,V16,V20,V3
T171|x|airtime @ hyperspeed: takeoff demands REAL crest (Δslope ≤ −0.02, ⊥ speed-amplified undulation pops) + downforce gravity ∝ v (fast hops stay short)|V16,V5
T172|x|frame-order fix (B34): exhaust/sparks read ship pose AFTER the sim writes it — trail head was one frame stale (gap = v·dt, 10m+ @ hyperspeed)|C11,V5
T173|x|perf passes REMAINING: TSL shader cost @ retina (post chain), per-frame alloc/GC audit (chase CPU dips w/ cpu+lt meters), geometry+effect LOD per quality tier|C7,C11
T174|x|carve/track rework: V2 skilled-pace re-anchor (vmax 3.0→1.36, accel 0.34→0.155, NPC pace → fractions); V20 carve-authority kScale; width 29-34 + widthScale floors ↑; wall malus graded; smoothstep transition windows + S-flip through flat; V24 downforce camber everywhere|V2,V20,V24,V3
T175|x|ENERGY system: hull drain (walls ∝ impact+speed, grind, ship-ship ∝ closing speed BOTH parties), 2s-grace regen, 0 → explosion (fireball+debris+flash) + 1.3s wreck pause + reset; damage film grain < 35% hull; ENERGY bar (purple tiers)|V22,V10
T176|x|NPC unification: stepNpc = controller over stepShip (ff+PD steer speed-scaled, smoothed aiThrottle, brake margins); grid FLIPPED (field ahead, player last) + poseAt negative-s extrapolation (B35); intro camera dolly READY→GO|V23,V15,V13
T177|x|SPLIT segments: lane forks 2× width around divider island (median = wall, physics+mesh+NPC lane commit), S-weave + camber flip, remerge; pads shoved off the island|V3,V24,V22
T178|x|perf round 1: dpr deterministic+capped (B36), pipeline warmup @ countdown, chunked track ribbons + fog-distance culling, bucketed scenery instancing, minimap offscreen bake, trail distance cull, spark idle skip, gpu/cpu/longtask instrumentation (PerfHud F2/?perf)|C7,C11,T173
T179|x|UX round: HUD v3 (THRUST=speed story w/ overdrive zone + flush ENERGY bar, eased segment heights), road signage patterns (slant→turn ahead, ticks→technical), restart in pause, fullscreen buttons, loading veil, TrackChips on setup, sponsor boards XL + neon rails, exhaust escalation w/ accent core (de-blinded), progressive kb steering, touch steer gain+centerline|V10,V6,C11
T180|x|scenery clearance vs WHOLE course (B37): spatial hash + corridor rejection for pylons/biome|V25
T181|x|song keep: SAVE SONG (pause + results) downloads session bytes, ext via magic-byte sniff; RECENTS in menu — localStorage meta records (V26), session bytes → instant replay, post-reload → re-import picker|I.ui,V26
T182|x|songId plumbing: store.songId set by EVERY flow entry; lobby resolves bundled|synth|user source by id (pure resolver, tested); synth host → lobby_song_synth msg (deterministic re-render joiner-side, V1)|V27,B38
T183|x|track records: per-track leaderboard (top-5 finished times) + best ghost persisted (V28); TrackSetup shows board + RACE YOUR GHOST; Results flags NEW RECORD; ghost recorder runs during ghost races (beat your ghost → it updates); B39 fix|V28,V26,V27,B39
T184|x|mobile default quality = medium (coarse pointer @ first run) — high stutters even flagship phones; persisted user choice always wins|C7,C3
T185|x|film grain OUT — animated seed crawled diagonally (subtle moving noise from race start); third grain complaint = delete, not dial|V10,V21
T186|x|MP joiner AUTO-enters race once song processed — manual JOIN RACE stall read as "client waiting, host playing"; host already waits in-scene|B22,I.ui
T187|x|steer latency ↓: digital initial attack 1.8→3.4, lock window 0.65→0.45 (half-lock ~220→~115ms, tap-nudge safety stays); ANALOG input (touch + NPC PD) skips progressive lock — flat fast attack|V18,V23,B7
T188|x|signaling resilience (B40): peer.reconnect() on 'disconnected' + foreground-return retry; e2e MP harness — scripts/e2e-mp.mjs spawns 2 chrome via puppeteer/CDP, drives host+join full flow to live race, freeze-emulates app-switch|B40,B20,B21
T189|x|adaptive field (V29): mid/back NPCs rubber-band to player gap (catch-up + hold-back, bounded), elite exempt — race stays close for weak players, ⊥ free wins for strong|V29,V13,V23
T190|~|launch sync v2 (V30): RTT-measured race_start (ping/pong) replaces 400ms guess; joiner auto-retries peer-unavailable ~30s; e2e freeze reordered — join attempt DURING host freeze (realistic share-link sample)|V30,B40,T88

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
B26|2026-06-10|T110 backdrop div is POSITIONED → paints over static-flow Results screen → all post-race buttons unclickable|pointer-events-none on backdrop wrapper (T117)
B27|2026-06-10|node materials w/o own envMap IGNORE material.envMapIntensity (scene.environmentIntensity wins) → road env mirror "slab" survived two fix attempts|kill mirror via roughness on node materials; per-material env intensity needs material.envMap set
B28|2026-06-11|ridge cones radius ≤230m placed 170m off-track → faces reached INTO the corridor|radius clamped to lateral−80 (Environment)
B29|2026-06-11|occluded tab suspends rAF → next frame's giant dt skipped countdown + fast-forwarded sim in one burst (B11 lesson, race-loop edition)|dt clamped to 0.1s in RaceScene frame loop
B30|2026-06-11|start-grid slot pads (6×9m, emissive glow 0.35, ×6) fused into one theme-colored carpet = the "green/red slab @ start" — blamed on apron, road env, ridges before raycast probe found it|slots dimmed to faint outlines (emissive 0.05, opacity 0.45)
B31|2026-06-11|section boundary truncates corkscrew → walkSegment still rolls FULL 2π over the stub → violent frame twist @ seam, hitch + ship kicked off|shrink to remaining if ≥320m else demote to straight; test pins min corkscrew length
B33|2026-06-11|sonic boom threshold vs UNBOOSTED vmax → every boost pad crossing re-fired it = random blips|threshold vs shipVmax(boosted) — boom only at the absolute ceiling (T168)
B34|2026-06-11|child useFrame subscribes before parent (bottom-up mount effects) → exhaust/sparks read ship pose ONE FRAME STALE → trail head detached by v·dt (10m+ @ hyperspeed)|readers get useFrame priority 0.5, pose writers stay 0 (T172)
B32|2026-06-11|walkSegment bank guard (`type !== curve && !== chicane → bank=0`) silently DISCARDED wallride banks since T92 — every "wallride" shipped flat; censuses counted them, nobody ever rode one|guard admits wallride + faster bank ease (0.4); test pins 60°/84° banks + rideability
B35|2026-06-11|poseAt CLAMPED s<0 to 0 → every grid ship rendered stacked AT the start line (physics grid fine, render collapsed) — "ships glitching through each other at start"|poseAt extrapolates s<0 along start tangent; render clamps removed (T176)
B36|2026-06-11|r3f `dpr` prop LOST during async WebGPU renderer init — canvas at pixelRatio 1 until first window resize, then jumped to 2: render res random per session, quality tiers never controlled startup res, "30fps sometimes"|DprSync child applies dpr post-mount, capped at devicePixelRatio (T178)
B37|2026-06-11|course crosses own footprint → scenery placed clear of OWN segment sat inside a DIFFERENT track section (towers/pylons through the road)|V25 corridor clearance: spatial hash of whole course, reject overlapping spawns (T180)
B38|2026-06-11|MP host resolved song by DISPLAY title — T100 "ARTIST — TITLE" compose broke BUNDLED_SONGS title match → bundled-track host: "Could not find track bytes to send!", joiner stuck @ connected|V27 (T182)
B39|2026-06-11|createGhostRecorder fed DISPLAY TITLE as songId + GhostLobby read never-set ghost.songTitle → shared ghost links for bundled tracks always demanded manual file pick|V27: recorder gets store.songId; lobby resolves ghost.songId by id w/ legacy title fallback (T183)
B40|2026-06-11|mobile app-switch (share link via messenger) suspends tab → PeerJS signaling socket dies → broker drops peer id; NO 'disconnected' handler → shared join link dead before friend taps it|peer.reconnect() on 'disconnected' + visibility-return retry — same id re-registers (T188)
