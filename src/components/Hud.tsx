import { useEffect, useMemo, useRef } from 'react'
import { telemetry } from '../game/telemetry'
import { useGame } from '../game/store'
import { NPC_ACCENTS } from '../lib/physics/npc'
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
      className="h-[190px] w-[230px] border border-white/15 bg-black/40 [@media(max-height:499px)]:h-[107px] [@media(max-height:499px)]:w-[130px]"
    />
  )
}

function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

const SPEED_SEGS = 14
const BOOST_SEGS = 8
const MAX_KPH = 1100

/**
 * HUD v2 (T19, V6): DOM-driven at display rate via rAF reading telemetry —
 * zero React re-renders during the race. All elements inside .hud-safe.
 */
export function Hud({ accent, track }: { accent: string; track?: TrackData }) {
  const speedRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const posRef = useRef<HTMLSpanElement>(null)
  const racersRef = useRef<HTMLSpanElement>(null)
  const boostLabelRef = useRef<HTMLDivElement>(null)
  const vignetteRef = useRef<HTMLDivElement>(null)
  const specBars = useRef<(HTMLDivElement | null)[]>([])
  const nowTimeRef = useRef<HTMLSpanElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<HTMLDivElement>(null)
  const speedCells = useRef<(HTMLDivElement | null)[]>([])
  const boostCells = useRef<(HTMLDivElement | null)[]>([])
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
    const tick = () => {
      raf = requestAnimationFrame(tick)
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
          el.className = 'absolute inset-0 flex items-center justify-center text-8xl font-bold italic tracking-widest text-white/80 drop-shadow-[0_0_20px_currentColor] sm:text-[12rem]'
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

      const speedFill = Math.round(Math.min(1, kph / MAX_KPH) * SPEED_SEGS)
      speedCells.current.forEach((cell, i) => {
        if (!cell) return
        const on = i < speedFill
        cell.style.opacity = on ? '1' : '0.13'
        cell.style.boxShadow = on ? `0 0 8px ${i >= SPEED_SEGS - 3 ? '#ff3355' : accent}` : 'none'
      })
      const boostFill = Math.round(Math.min(1, telemetry.boost / 1.1) * BOOST_SEGS)
      boostCells.current.forEach((cell, i) => {
        if (!cell) return
        cell.style.opacity = i < boostFill ? '1' : '0.13'
      })
      if (boostLabelRef.current) boostLabelRef.current.style.opacity = telemetry.boost > 0 ? '1' : '0.25'

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
      // V10: speed lines + boost flash scale with fxIntensity, 0 → invisible
      if (linesRef.current) {
        const o = (Math.max(0, (kph - 260) / 650) + telemetry.beat * 0.08) * fxRef.current
        linesRef.current.style.opacity = Math.min(0.9, o).toFixed(3)
      }
      if (flashRef.current) {
        flashRef.current.style.opacity = (telemetry.boostFlash * 0.5 * fxRef.current).toFixed(3)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [accent])

  return (
    <div className="pointer-events-none absolute inset-0">
      <div ref={vignetteRef} className="absolute inset-0" />
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
        <span className="glass-panel inline-block px-12 py-5" style={{ display: 'none' }} />
      </div>

      <div className="hud-safe absolute inset-0 flex flex-col justify-between p-5">
        {/* top: time | waveform progress | pos + speed column (T67) */}
        <div className="flex items-start gap-5">
          <div className="-skew-x-12 border-l-4 bg-black/50 px-4 py-1.5" style={{ borderColor: accent }}>
            <div className="text-[10px] tracking-[0.4em] text-white/40">TIME</div>
            <span
              ref={timeRef}
              className="text-2xl font-bold tabular-nums tracking-wider"
              style={{ color: accent, textShadow: `0 0 12px ${accent}` }}
            >
              0:00.00
            </span>
          </div>
          {/* T67: progress = the song's own waveform, revealed as you ride it */}
          <div className="relative mt-1 h-12 flex-1 -skew-x-12 overflow-hidden border border-white/15 bg-black/50 px-1">
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
          <div className="flex flex-col items-end gap-2">
            <div className="-skew-x-12 border-r-4 bg-black/50 px-4 py-1.5 text-right" style={{ borderColor: accent }}>
              <div className="text-[10px] tracking-[0.4em] text-white/40">
                POS · <span className="text-white/70">{cameraMode === 'chase' ? '3P' : '1P'}</span>
              </div>
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: accent, textShadow: `0 0 12px ${accent}` }}
              >
                <span ref={posRef}>1</span>
                <span ref={racersRef} className="text-sm text-white/50">/6</span>
              </span>
            </div>
            {/* T67: speed + boost live top-right — clear of mobile thumb zones */}
            {/* T83: LCARS-bold readout — big pills, heavy type */}
            <div
              className="w-fit self-end rounded-l-2xl border-r-4 bg-gradient-to-l from-black/55 via-black/30 to-transparent py-1.5 pr-3 pl-8 text-right [@media(min-height:500px)]:border-r-8 [@media(min-height:500px)]:py-2.5 [@media(min-height:500px)]:pr-4 [@media(min-height:500px)]:pl-12"
              style={{ borderColor: accent }}
            >
              <div className="mb-1.5 flex items-center justify-end gap-2.5">
                <div ref={boostLabelRef} className="text-[9px] font-black tracking-[0.4em] text-(--color-amber-hud) [@media(min-height:500px)]:text-xs">
                  BOOST
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: BOOST_SEGS }, (_, i) => (
                    <div
                      key={i}
                      ref={(el) => void (boostCells.current[i] = el)}
                      className="h-2.5 w-2 rounded-sm bg-(--color-amber-hud) [@media(min-height:500px)]:h-4 [@media(min-height:500px)]:w-3"
                      style={{ opacity: 0.13 }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-baseline justify-end gap-2">
                <span
                  ref={speedRef}
                  className="inline-block text-4xl font-black tabular-nums leading-none [@media(min-height:500px)]:text-8xl"
                  style={{ color: accent, textShadow: `0 0 24px ${accent}` }}
                >
                  0
                </span>
                <span className="text-xs font-bold tracking-[0.3em] text-white/70 [@media(min-height:500px)]:text-base">KPH</span>
              </div>
              <div className="mt-2 flex justify-end gap-1">
                {Array.from({ length: SPEED_SEGS }, (_, i) => (
                  <div
                    key={i}
                    ref={(el) => void (speedCells.current[i] = el)}
                    className="h-3 w-2.5 rounded-sm [@media(min-height:500px)]:h-5 [@media(min-height:500px)]:w-4"
                    style={{
                      opacity: 0.13,
                      background: i >= SPEED_SEGS - 3 ? '#ff3355' : accent,
                    }}
                  />
                ))}
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
              <div className="flex h-7 items-end gap-[3px]" aria-hidden>
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
                className="max-w-[220px] truncate text-[11px] font-bold tracking-[0.2em] text-white"
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
