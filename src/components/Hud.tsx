import { useEffect, useMemo, useRef } from 'react'
import { telemetry } from '../game/telemetry'
import { useGame } from '../game/store'
import { NPC_ACCENTS } from '../lib/physics/npc'
import type { TrackData } from '../lib/track/generate'

const MAP_SIZE = 148

/** T48: top-down course map + live racer dots, canvas-drawn at display rate */
function Minimap({ track, accent }: { track: TrackData; accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const proj = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const p of track.points) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.z < minZ) minZ = p.z
      if (p.z > maxZ) maxZ = p.z
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 1)
    const scale = (MAP_SIZE - 16) / span
    const ox = (MAP_SIZE - (maxX - minX) * scale) / 2 - minX * scale
    const oz = (MAP_SIZE - (maxZ - minZ) * scale) / 2 - minZ * scale
    const toMap = (x: number, z: number): [number, number] => [x * scale + ox, z * scale + oz]
    return { toMap }
  }, [track.points])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE)
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.lineWidth = 2
      ctx.beginPath()
      track.points.forEach((p, i) => {
        const [x, y] = proj.toMap(p.x, p.z)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
      // npc dots first, player on top
      for (let i = 1; i < telemetry.racers; i++) {
        const [x, y] = proj.toMap(telemetry.racersXZ[i * 2], telemetry.racersXZ[i * 2 + 1])
        ctx.fillStyle = NPC_ACCENTS[i - 1] ?? '#ffffff'
        ctx.beginPath()
        ctx.arc(x, y, 2.4, 0, Math.PI * 2)
        ctx.fill()
      }
      const [px, py] = proj.toMap(telemetry.racersXZ[0], telemetry.racersXZ[1])
      ctx.fillStyle = accent
      ctx.shadowColor = accent
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.arc(px, py, 3.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [track.points, proj, accent])

  return (
    <canvas
      ref={canvasRef}
      width={MAP_SIZE}
      height={MAP_SIZE}
      className="border border-white/15 bg-black/40"
      style={{ width: MAP_SIZE, height: MAP_SIZE }}
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
  const progressRef = useRef<HTMLDivElement>(null)
  const boostLabelRef = useRef<HTMLDivElement>(null)
  const vignetteRef = useRef<HTMLDivElement>(null)
  const pulseRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const countdownRef = useRef<HTMLDivElement>(null)
  const speedCells = useRef<(HTMLDivElement | null)[]>([])
  const boostCells = useRef<(HTMLDivElement | null)[]>([])
  const cameraMode = useGame((s) => s.cameraMode)
  const fxIntensity = useGame((s) => s.settings.fxIntensity)
  const fxRef = useRef(fxIntensity)
  fxRef.current = fxIntensity

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const kph = telemetry.speed * 3.6
      if (speedRef.current) speedRef.current.textContent = String(Math.round(kph))
      if (timeRef.current) timeRef.current.textContent = fmtTime(telemetry.timeMs)
      if (countdownRef.current) {
        const c = telemetry.countdown
        const el = countdownRef.current
        if (c > 0) {
          el.textContent = String(Math.ceil(c))
          el.style.opacity = String(0.4 + (c % 1) * 0.6)
          el.style.transform = `translate(-50%, -50%) scale(${1 + (1 - (c % 1)) * 0.35})`
        } else if (c > -0.9) {
          el.textContent = 'GO'
          el.style.opacity = String(Math.max(0, (c + 0.9) / 0.9))
          el.style.transform = `translate(-50%, -50%) scale(${1.2 - (c + 0.9) * 0.2})`
        } else {
          el.textContent = ''
          el.style.opacity = '0'
        }
      }
      if (posRef.current) posRef.current.textContent = `${telemetry.position}`
      if (racersRef.current) racersRef.current.textContent = `/${telemetry.racers}`
      if (progressRef.current) progressRef.current.style.width = `${(telemetry.progress * 100).toFixed(2)}%`

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
      if (pulseRef.current) pulseRef.current.style.opacity = String(0.25 + telemetry.energy * 0.75)
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
      {/* T35 countdown */}
      <div
        ref={countdownRef}
        className="absolute top-1/2 left-1/2 text-9xl font-bold tracking-widest"
        style={{
          color: accent,
          textShadow: `0 0 40px ${accent}, 0 0 120px ${accent}`,
          transform: 'translate(-50%, -50%)',
          opacity: 0,
        }}
      />

      <div className="hud-safe absolute inset-0 flex flex-col justify-between py-3">
        {/* top: time | progress | position */}
        <div className="flex items-center gap-5">
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
          <div className="relative h-3.5 flex-1 -skew-x-12 overflow-hidden border border-white/20 bg-black/50">
            <div
              ref={progressRef}
              className="h-full"
              style={{
                width: '0%',
                background: `linear-gradient(90deg, ${accent}55, ${accent})`,
                boxShadow: `0 0 14px ${accent}`,
              }}
            />
          </div>
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
        </div>

        {/* bottom: map+eq | speed block */}
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-2">
            {track && <Minimap track={track} accent={accent} />}
            <div ref={pulseRef} className="ml-1 flex items-end gap-1" aria-hidden>
            {[3, 5, 8, 6, 4].map((h, i) => (
              <div
                key={i}
                className="w-1.5 animate-[pulse-glow_0.6s_ease-in-out_infinite]"
                style={{ height: h * 4, background: accent, animationDelay: `${i * 80}ms` }}
              />
            ))}
            </div>
          </div>

          <div className="-skew-x-12 border-r-4 bg-black/50 px-5 py-2 text-right" style={{ borderColor: accent }}>
            {/* boost: segmented amber bar */}
            <div className="mb-1 flex items-center justify-end gap-2">
              <div ref={boostLabelRef} className="text-[10px] font-bold tracking-[0.4em] text-(--color-amber-hud)">
                BOOST
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: BOOST_SEGS }, (_, i) => (
                  <div
                    key={i}
                    ref={(el) => void (boostCells.current[i] = el)}
                    className="h-2.5 w-2 bg-(--color-amber-hud)"
                    style={{ opacity: 0.13, clipPath: 'polygon(30% 0, 100% 0, 70% 100%, 0 100%)' }}
                  />
                ))}
              </div>
            </div>
            <div>
              <span
                ref={speedRef}
                className="text-6xl font-bold tabular-nums leading-none"
                style={{ color: accent, textShadow: `0 0 18px ${accent}` }}
              >
                0
              </span>
              <span className="ml-2 text-sm tracking-widest text-white/60">KPH</span>
            </div>
            {/* speed: segmented thrust bar, top cells run hot */}
            <div className="mt-1.5 flex justify-end gap-0.5">
              {Array.from({ length: SPEED_SEGS }, (_, i) => (
                <div
                  key={i}
                  ref={(el) => void (speedCells.current[i] = el)}
                  className="h-3 w-3"
                  style={{
                    opacity: 0.13,
                    background: i >= SPEED_SEGS - 3 ? '#ff3355' : accent,
                    clipPath: 'polygon(30% 0, 100% 0, 70% 100%, 0 100%)',
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
