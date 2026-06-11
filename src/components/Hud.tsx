import { useEffect, useMemo, useRef } from 'react'
import { telemetry } from '../game/telemetry'
import { useGame } from '../game/store'
import { NPC_ACCENTS } from '../lib/physics/npc'
import { shipVmax } from '../lib/physics/ship'
import { fmtDuration } from '../lib/audio/waveform'
import type { TrackData } from '../lib/track/generate'

const PROG_BARS = 96

const MAP_W = 230
const MAP_H = 190
// T49: oblique 2.5D — z compressed, altitude lifts the line
const Z_SQUASH = 0.68
const Y_LIFT = 1.35

/** T48/T49: oblique course map — ground shadow ↔ path gap shows altitude */
function Minimap({ track, accent }: { track: TrackData; accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const proj = useMemo(() => {
    let yMin = Infinity
    for (const p of track.points) if (p.y < yMin) yMin = p.y
    const pts = track.points.map((p) => ({
      sx: p.x,
      sy: p.z * Z_SQUASH - (p.y - yMin) * Y_LIFT,
      gy: p.z * Z_SQUASH, // ground shadow (altitude flattened)
      h: p.y - yMin,
    }))
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, hMax = 1
    for (const p of pts) {
      if (p.sx < minX) minX = p.sx
      if (p.sx > maxX) maxX = p.sx
      if (Math.min(p.sy, p.gy) < minY) minY = Math.min(p.sy, p.gy)
      if (Math.max(p.sy, p.gy) > maxY) maxY = Math.max(p.sy, p.gy)
      if (p.h > hMax) hMax = p.h
    }
    const scale = Math.min((MAP_W - 18) / Math.max(1, maxX - minX), (MAP_H - 18) / Math.max(1, maxY - minY))
    const ox = (MAP_W - (maxX - minX) * scale) / 2 - minX * scale
    const oy = (MAP_H - (maxY - minY) * scale) / 2 - minY * scale
    const world = (x: number, y: number, z: number): [number, number] => [
      x * scale + ox,
      (z * Z_SQUASH - (y - yMin) * Y_LIFT) * scale + oy,
    ]
    return { pts, scale, ox, oy, hMax, world }
  }, [track.points])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      ctx.clearRect(0, 0, MAP_W, MAP_H)
      const { pts, scale, ox, oy, hMax } = proj

      // ground shadow — flat footprint
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      pts.forEach((p, i) => {
        const x = p.sx * scale + ox
        const y = p.gy * scale + oy
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      // altitude struts every ~12th point
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      for (let i = 0; i < pts.length; i += 12) {
        const p = pts[i]
        ctx.beginPath()
        ctx.moveTo(p.sx * scale + ox, p.gy * scale + oy)
        ctx.lineTo(p.sx * scale + ox, p.sy * scale + oy)
        ctx.stroke()
      }
      // elevated path, brightness = altitude
      ctx.lineWidth = 2.2
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        const l = 38 + (b.h / proj.hMax) * 52
        ctx.strokeStyle = `hsl(0 0% ${l}% / 0.85)`
        ctx.beginPath()
        ctx.moveTo(a.sx * scale + ox, a.sy * scale + oy)
        ctx.lineTo(b.sx * scale + ox, b.sy * scale + oy)
        ctx.stroke()
      }
      void hMax

      // npc dots, then player glowing on top
      for (let i = 1; i < telemetry.racers; i++) {
        const [x, y] = proj.world(
          telemetry.racersXZ[i * 3],
          telemetry.racersXZ[i * 3 + 1],
          telemetry.racersXZ[i * 3 + 2],
        )
        ctx.fillStyle = NPC_ACCENTS[i - 1] ?? '#ffffff'
        ctx.beginPath()
        ctx.arc(x, y, 2.6, 0, Math.PI * 2)
        ctx.fill()
      }
      const [px, py] = proj.world(telemetry.racersXZ[0], telemetry.racersXZ[1], telemetry.racersXZ[2])
      ctx.fillStyle = accent
      ctx.shadowColor = accent
      ctx.shadowBlur = 7
      ctx.beginPath()
      ctx.arc(px, py, 3.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [proj, accent])

  return (
    <canvas
      ref={canvasRef}
      width={MAP_W}
      height={MAP_H}
      className="h-[190px] w-[230px] border border-white/15 bg-black/40 short:h-[107px] short:w-[130px]"
    />
  )
}

function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

// HUD v3: TWO bars. THRUST = speed-toward-ceiling (throttle, speed and boost
// are one physical story — the last segments are overdrive, only boost
// reaches them). ENERGY = hull. Segment heights GROW toward the top end.
// Same segment count/width so the two bars sit flush as one instrument.
const THRUST_SEGS = 14
const ENERGY_SEGS = 14
const ENERGY_COL = '#a06bff'

/**
 * HUD v2 (T19, V6): DOM-driven at display rate via rAF reading telemetry —
 * zero React re-renders during the race. All elements inside .hud-safe.
 */
export function Hud({ accent, track }: { accent: string; track?: TrackData }) {
  const speedRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const posRef = useRef<HTMLSpanElement>(null)
  const racersRef = useRef<HTMLSpanElement>(null)
  const vignetteRef = useRef<HTMLDivElement>(null)
  const specBars = useRef<(HTMLDivElement | null)[]>([])
  const nowTimeRef = useRef<HTMLSpanElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const linesOff = useRef(0)
  const linesBucket = useRef(-1)
  const vigBucket = useRef(-1)
  const lastTs = useRef(0)
  const vigRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<HTMLDivElement>(null)
  const thrustCells = useRef<(HTMLDivElement | null)[]>([])
  const energyCells = useRef<(HTMLDivElement | null)[]>([])
  const thrustLabelRef = useRef<HTMLDivElement>(null)
  const energyLabelRef = useRef<HTMLDivElement>(null)
  const cameraMode = useGame((s) => s.cameraMode)
  const fxIntensity = useGame((s) => s.settings.fxIntensity)
  const songTitle = useGame((s) => s.songTitle)
  const features = useGame((s) => s.features)
  const progressClip = useRef<HTMLDivElement>(null)

  const fxRef = useRef(fxIntensity)
  fxRef.current = fxIntensity

  // T67: progress bar = waveform approximation from the analyzed energy curve
  const progPeaks = useMemo(() => {
    if (!features) return Array(PROG_BARS).fill(0.5) as number[]
    const e = features.energy
    const out: number[] = []
    const per = Math.max(1, Math.floor(e.length / PROG_BARS))
    for (let b = 0; b < PROG_BARS; b++) {
      let peak = 0.12
      for (let i = b * per; i < Math.min(e.length, (b + 1) * per); i += 2) peak = Math.max(peak, e[i])
      // T85: perceptual curve — quiet structure stays visible
      out.push(Math.pow(peak, 0.45))
    }
    return out
  }, [features])

  useEffect(() => {
    let raf = 0
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (ts - lastTs.current) / 1000 || 0)
      lastTs.current = ts
      const kph = telemetry.speed * 3.6
      if (speedRef.current) speedRef.current.textContent = String(Math.round(kph))
      if (timeRef.current) timeRef.current.textContent = fmtTime(telemetry.timeMs)
      const el = countdownRef.current
      // T136: text lives in the inner glass-chip span; chip hides when empty
      const chip = el?.firstElementChild as HTMLElement | null
      if (el && chip) {
        if (telemetry.syncState === 'waiting') {
          chip.textContent = telemetry.oppStatus || 'WAITING FOR OPPONENT...'
          chip.style.display = 'inline-block'
          el.className = 'absolute inset-0 flex items-center justify-center text-4xl font-bold tracking-[0.2em] text-white/80 animate-pulse'
        } else {
          // T129: 12rem digits only when BOTH wide and tall — landscape phones stay at 8xl
          el.className = 'absolute inset-0 flex items-center justify-center text-8xl font-bold italic tracking-widest text-white/80 drop-shadow-[0_0_20px_currentColor] [@media(min-width:640px)_and_(min-height:561px)]:text-[12rem]'
          const c = Math.ceil(telemetry.countdown)
          if (telemetry.countdown > 3) chip.textContent = 'READY'
          else if (c > 0 && c <= 3) chip.textContent = String(c)
          else if (telemetry.countdown > -1 && telemetry.countdown <= 0) chip.textContent = 'GO'
          else chip.textContent = ''
          chip.style.display = chip.textContent ? 'inline-block' : 'none'
          if (telemetry.countdown > 3) {
            // B24: hold READY steady before the digits roll
            el.style.transform = 'scale(0.42)'
            el.style.opacity = '0.85'
            el.style.color = accent
          } else if (telemetry.countdown > -1 && telemetry.countdown <= 0) {
            el.style.transform = `scale(${1 + Math.max(0, telemetry.countdown + 1) * 0.5})`
            el.style.opacity = String(Math.max(0, telemetry.countdown + 1))
            el.style.color = '#ff2fd6'
          } else if (c > 0 && c <= 3) {
            const frac = c - telemetry.countdown
            el.style.transform = `scale(${1.2 - frac * 0.2})`
            el.style.opacity = String(1 - frac)
            el.style.color = accent
          }
        }
      }
      if (posRef.current) posRef.current.textContent = `${telemetry.position}`
      if (racersRef.current) racersRef.current.textContent = `/${telemetry.racers}`
      if (progressClip.current) {
        progressClip.current.style.clipPath = `inset(0 ${(100 - telemetry.progress * 100).toFixed(2)}% 0 0)`
      }
      // T72: speedo pops on boost, runs amber while the field is hot
      if (speedRef.current) {
        speedRef.current.style.transform = `scale(${1 + telemetry.boostFlash * 0.16})`
        speedRef.current.style.color = telemetry.boost > 0 ? '#ffb13d' : accent
      }

      // THRUST: one bar tells the whole speed story — fill = v toward the
      // BOOSTED ceiling; segments past the no-boost ceiling are the
      // overdrive zone, only reachable on a boost chain
      const vmaxB = track ? shipVmax(track.avgSpeed, true) : 700
      const vmaxNB = track ? shipVmax(track.avgSpeed, false) : 600
      const odStart = Math.floor((vmaxNB / vmaxB) * THRUST_SEGS)
      const tFill = Math.round(Math.min(1, telemetry.speed / vmaxB) * THRUST_SEGS)
      thrustCells.current.forEach((cell, i) => {
        if (!cell) return
        const on = i < tFill
        const od = i >= odStart
        const col = od ? '#ff2fd6' : '#ffb13d'
        cell.style.opacity = on ? '1' : '0.12'
        cell.style.background = on && od && telemetry.boostFlash > 0.4 ? '#ffffff' : col
        cell.style.boxShadow = on ? `0 0 12px ${col}` : 'none'
      })
      if (thrustLabelRef.current) {
        thrustLabelRef.current.style.color = telemetry.boost > 0 ? '#ff2fd6' : '#ffb13d'
      }

      // ENERGY: hull integrity — purple base (distinct from theme), amber
      // warning, red panic; damage flashes the lit cells white
      const hull = telemetry.hull
      const eFill = Math.ceil(hull * ENERGY_SEGS)
      const eCol = hull < 0.25 ? '#ff3355' : hull < 0.5 ? '#ffb13d' : ENERGY_COL
      energyCells.current.forEach((cell, i) => {
        if (!cell) return
        const on = i < eFill
        cell.style.opacity = on ? '1' : '0.12'
        cell.style.background = telemetry.hullFlash > 0.6 && on ? '#ffffff' : eCol
        cell.style.boxShadow = on ? `0 0 12px ${eCol}` : 'none'
      })
      if (energyLabelRef.current) {
        energyLabelRef.current.style.color = eCol
        // low hull: the label itself screams
        energyLabelRef.current.style.opacity = hull < 0.25 ? String(0.5 + 0.5 * Math.abs(Math.sin(telemetry.timeMs / 120))) : '0.9'
      }

      if (vignetteRef.current) {
        const w = telemetry.wallFlash
        vignetteRef.current.style.boxShadow =
          w > 0.02 ? `inset 0 0 ${80 + w * 60}px rgba(255,40,60,${0.45 * w})` : 'none'
      }
      // T82: live pseudo-spectrum — energy sets the body, centroid moves the
      // bright lobe, beats kick the high bins
      specBars.current.forEach((el, i) => {
        if (!el) return
        const x = i / 13
        const amp =
          Math.max(0.06, telemetry.energy * (1.05 - Math.abs(x - telemetry.centroid) * 1.4)) +
          telemetry.beat * (x > 0.65 ? 0.4 : 0.08)
        el.style.height = `${Math.min(100, amp * 100).toFixed(1)}%`
      })
      if (nowTimeRef.current) {
        nowTimeRef.current.textContent = fmtDuration(telemetry.songTime)
      }
      // V10: speed lines + boost flash scale with fxIntensity, 0 → invisible.
      // Lines v2: they MOVE (mask scrolls with speed) and REACH — the streak
      // field spreads inward as speed climbs, a building tunnel, not a static
      // sticker that fades in once and is done
      if (linesRef.current) {
        const spN = Math.min(1, Math.max(0, (kph - 280) / 1500))
        const o = (spN * 1.05 + telemetry.beat * 0.06) * fxRef.current
        linesRef.current.style.opacity = Math.min(0.85, o).toFixed(3)
        // scroll: px/s ∝ speed — streaks visibly RUSH past
        linesOff.current = (linesOff.current + kph * dt * 0.7) % 14
        linesRef.current.style.maskPosition = `0px ${(-linesOff.current).toFixed(1)}px`
        // spread: rebuild the gradient only when the (quantized) level moves
        const bucket = Math.round(spN * 12)
        if (bucket !== linesBucket.current) {
          linesBucket.current = bucket
          const reach = 7 + bucket * 1.6 // % of screen each side
          linesRef.current.style.background = `linear-gradient(90deg, rgba(255,255,255,0.55) 0%, transparent ${reach}%, transparent ${100 - reach}%, rgba(255,255,255,0.55) 100%)`
        }
      }
      // T162 v3: guaranteed BLACK vignette in the DOM — the post-chain one
      // got buried under bloom/heat. Starts breathing at ~400 kph, closes
      // toward a tight tunnel at the top end (fx-gated, V10)
      if (vigRef.current) {
        const vN = Math.min(1, Math.max(0, (kph - 400) / 1600)) * fxRef.current
        const vb = Math.round(vN * 24)
        if (vb !== vigBucket.current) {
          vigBucket.current = vb
          const inner = 78 - vb * 1.7 // transparent radius % — shrinks the view
          const alpha = (vb / 24) * 0.82
          vigRef.current.style.background =
            vb === 0
              ? 'none'
              : `radial-gradient(ellipse at center, transparent ${inner.toFixed(0)}%, rgba(0,0,0,${alpha.toFixed(3)}) 100%)`
        }
      }
      if (flashRef.current) {
        flashRef.current.style.opacity = (telemetry.boostFlash * 0.5 * fxRef.current).toFixed(3)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [accent, track])

  return (
    <div className="pointer-events-none absolute inset-0">
      <div ref={vignetteRef} className="absolute inset-0" />
      {/* speed tunnel-vision: DOM black vignette, driven from ~400 kph */}
      <div ref={vigRef} className="absolute inset-0" />
      {/* speed lines: edge streaks that fade in past ~350 kph */}
      <div
        ref={linesRef}
        className="absolute inset-0 opacity-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(255,255,255,0.5) 0%, transparent 12%, transparent 88%, rgba(255,255,255,0.5) 100%)',
          maskImage: 'repeating-linear-gradient(0deg, black 0px, black 2px, transparent 3px, transparent 14px)',
        }}
      />
      <div
        ref={flashRef}
        className="absolute inset-0 opacity-0"
        style={{ background: `radial-gradient(ellipse at center, transparent 35%, ${accent} 130%)` }}
      />
      {/* T35 countdown — T136: glass chip so it isn't lost in space */}
      <div
        ref={countdownRef}
        className="absolute top-1/2 left-1/2 text-9xl font-bold tracking-widest"
        style={{
          color: accent,
          textShadow: `0 0 40px ${accent}, 0 0 120px ${accent}`,
          transform: 'translate(-50%, -50%)',
          opacity: 0,
        }}
      >
        {/* T146: soft halo, not a box — radial shade pools behind the glyphs */}
        <span
          className="inline-block px-16 py-8"
          style={{
            display: 'none',
            background: 'radial-gradient(ellipse 60% 50% at center, rgba(2,4,10,0.72), rgba(2,4,10,0.35) 55%, transparent 75%)',
          }}
        />
      </div>

      <div className="hud-safe absolute inset-0 flex flex-col justify-between p-5 short:p-2.5">
        {/* top: time | waveform progress | pos + speed column (T67) */}
        <div className="flex items-start gap-5 short:gap-3">
          <div className="-skew-x-12 border-l-4 bg-black/50 px-4 py-1.5 short:px-2.5 short:py-1" style={{ borderColor: accent }}>
            <div className="text-[10px] tracking-[0.4em] text-white/40 short:text-[8px]">TIME</div>
            <span
              ref={timeRef}
              className="text-2xl font-bold tabular-nums tracking-wider short:text-lg"
              style={{ color: accent, textShadow: `0 0 12px ${accent}` }}
            >
              0:00.00
            </span>
          </div>
          {/* T67: progress = the song's own waveform, revealed as you ride it */}
          <div className="relative mt-1 h-12 flex-1 -skew-x-12 overflow-hidden border border-white/15 bg-black/50 px-1 short:h-8">
            <div className="absolute inset-x-1 inset-y-0 flex items-center gap-px opacity-20">
              {progPeaks.map((p, i) => (
                <div key={i} className="flex-1" style={{ height: `${Math.max(8, p * 92)}%`, background: accent }} />
              ))}
            </div>
            <div
              ref={progressClip}
              className="absolute inset-x-1 inset-y-0 flex items-center gap-px"
              style={{ clipPath: 'inset(0 100% 0 0)', filter: `drop-shadow(0 0 6px ${accent})` }}
            >
              {progPeaks.map((p, i) => (
                <div key={i} className="flex-1" style={{ height: `${Math.max(8, p * 92)}%`, background: accent }} />
              ))}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="-skew-x-12 border-r-4 bg-black/50 px-4 py-1.5 text-right short:px-2.5 short:py-1" style={{ borderColor: accent }}>
              <div className="text-[10px] tracking-[0.4em] text-white/40 short:text-[8px]">
                POS · <span className="text-white/70">{cameraMode === 'chase' ? '3P' : '1P'}</span>
              </div>
              <span
                className="text-2xl font-bold tabular-nums short:text-lg"
                style={{ color: accent, textShadow: `0 0 12px ${accent}` }}
              >
                <span ref={posRef}>1</span>
                <span ref={racersRef} className="text-sm text-white/50">/6</span>
              </span>
            </div>
            {/* T67: speed + boost live top-right — clear of mobile thumb zones */}
            {/* T83: LCARS-bold readout — big pills, heavy type */}
            <div
              className="w-fit self-end rounded-l-2xl border-r-8 bg-gradient-to-l from-black/55 via-black/30 to-transparent py-1.5 pr-3 pl-7 text-right short:border-r-4 short:py-1 short:pr-2.5 short:pl-5"
              style={{ borderColor: accent }}
            >
              <div className="flex items-baseline justify-end gap-2">
                <span
                  ref={speedRef}
                  className="inline-block text-8xl font-black tabular-nums leading-none short:text-4xl"
                  style={{ color: accent, textShadow: `0 0 24px ${accent}` }}
                >
                  0
                </span>
                <span className="text-base font-bold tracking-[0.3em] text-white/70 short:text-xs">KPH</span>
              </div>
              {/* HUD v3 (WipEout ref): one flush instrument — THRUST on top
                  (slope rising along its top edge), ENERGY mirrored beneath
                  (slope falling along its bottom edge), labels bracketing */}
              <div className="mt-1 flex origin-right flex-col items-end short:scale-[0.68]">
                <div ref={thrustLabelRef} className="text-[11px] font-black tracking-[0.4em] text-(--color-amber-hud)">
                  THRUST
                </div>
                {/* THRUST = speed→ceiling; magenta tail = boost overdrive.
                    Heights ease in: gentle low end, pronounced swell at the top */}
                <div className="flex items-end gap-[3px]">
                  {Array.from({ length: THRUST_SEGS }, (_, i) => (
                    <div
                      key={i}
                      ref={(el) => void (thrustCells.current[i] = el)}
                      className="w-4 -skew-x-12 rounded-[2px] border border-white/15"
                      style={{
                        height: `${12 + Math.pow(i / (THRUST_SEGS - 1), 1.9) * 22}px`,
                        opacity: 0.12,
                        background: '#ffb13d',
                      }}
                    />
                  ))}
                </div>
                {/* ENERGY: flipped — flat seam against THRUST, slope below.
                    Slimmer than THRUST, softer swell */}
                <div className="mt-[3px] flex items-start gap-[3px]">
                  {Array.from({ length: ENERGY_SEGS }, (_, i) => (
                    <div
                      key={i}
                      ref={(el) => void (energyCells.current[i] = el)}
                      className="w-4 -skew-x-12 rounded-[2px] border border-white/15"
                      style={{
                        height: `${8 + Math.pow(i / (ENERGY_SEGS - 1), 1.6) * 9}px`,
                        opacity: 1,
                        background: ENERGY_COL,
                      }}
                    />
                  ))}
                </div>
                <div ref={energyLabelRef} className="text-[11px] font-black tracking-[0.4em]" style={{ color: ENERGY_COL }}>
                  ENERGY
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* bottom-left: map + track id + eq (T67) */}
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-1.5">
            {track && <Minimap track={track} accent={accent} />}
            {/* T82: now-playing strip — live spectrum | title | time, music-video style */}
            <div className="ml-1 flex items-center gap-3">
              <div className="flex h-7 items-end gap-[3px] short:h-5" aria-hidden>
                {Array.from({ length: 14 }, (_, i) => (
                  <div
                    key={i}
                    ref={(el) => void (specBars.current[i] = el)}
                    className="w-[3px]"
                    style={{ height: '8%', background: accent, boxShadow: `0 0 4px ${accent}` }}
                  />
                ))}
              </div>
              <span
                className="max-w-[220px] truncate text-[11px] font-bold tracking-[0.2em] text-white short:max-w-[150px] short:text-[10px]"
                style={{ textShadow: `0 0 10px ${accent}` }}
              >
                {songTitle || 'UNKNOWN FREQUENCY'}
              </span>
              <span className="text-xs tabular-nums tracking-widest text-white/50">
                <span ref={nowTimeRef}>0:00</span>
                {track ? ` / ${fmtDuration(track.duration)}` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
