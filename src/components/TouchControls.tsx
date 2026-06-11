import { useEffect, useRef, useState } from 'react'
import { touch } from '../game/input'

/**
 * Touch layout (T6, I.ctl): left half = analog steer (drag horizontally),
 * right side = thrust + airbrake buttons. Only rendered on coarse pointers.
 */
export function TouchControls() {
  const steerZone = useRef<HTMLDivElement>(null)
  // T156: thrust-button pointer origin for the pull-back gesture
  const thrustY = useRef<number | null>(null)
  // T138: first-time hint — fades once the player actually steers (or 8s)
  const [hint, setHint] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 8000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const zone = steerZone.current
    if (!zone) return
    let activeId: number | null = null

    const steerFrom = (clientX: number) => {
      const rect = zone.getBoundingClientRect()
      const raw = ((clientX - rect.left) / rect.width) * 2 - 1
      // sensitivity: ~45% of the half-zone = full lock (thumb stays near the
      // center line), expo curve keeps small offsets fine-grained
      const g = Math.max(-1, Math.min(1, raw / 0.45))
      touch.setSteer(Math.sign(g) * Math.pow(Math.abs(g), 1.35))
    }
    const down = (e: PointerEvent) => {
      activeId = e.pointerId
      steerFrom(e.clientX)
      setHint(false)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerId === activeId) steerFrom(e.clientX)
    }
    const up = (e: PointerEvent) => {
      if (e.pointerId === activeId) {
        activeId = null
        touch.setSteer(null)
      }
    }
    zone.addEventListener('pointerdown', down)
    zone.addEventListener('pointermove', move)
    zone.addEventListener('pointerup', up)
    zone.addEventListener('pointercancel', up)
    return () => {
      zone.removeEventListener('pointerdown', down)
      zone.removeEventListener('pointermove', move)
      zone.removeEventListener('pointerup', up)
      zone.removeEventListener('pointercancel', up)
      touch.setSteer(null)
    }
  }, [])

  const hold =
    (set: (on: boolean) => void) =>
    ({
      onPointerDown: () => set(true),
      onPointerUp: () => set(false),
      onPointerCancel: () => set(false),
      onPointerLeave: () => set(false),
    }) as const

  return (
    <div className="absolute inset-0 hidden touch-none select-none [@media(pointer:coarse)]:block">
      <div ref={steerZone} className="absolute top-0 bottom-0 left-0 w-1/2">
        {/* subtle center-line: neutral steer reference for the thumb */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-gradient-to-t from-white/25 via-white/10 to-transparent" />
        <div className="pointer-events-none absolute bottom-10 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rotate-45 border border-white/30" />
        <div className="absolute bottom-6 left-6 text-xs tracking-[0.3em] text-white/30">◄ STEER ►</div>
        {/* T138: first-run hint — your LEFT THUMB drives */}
        {hint && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 transition-opacity duration-700">
            <div className="glass-panel animate-pulse px-5 py-3 text-center">
              <p className="text-2xl">👈 👆 👉</p>
              <p className="mt-1 text-xs tracking-[0.3em] text-white/80">LEFT THUMB HERE</p>
              <p className="text-[10px] tracking-[0.25em] text-white/50">DRAG TO STEER</p>
            </div>
          </div>
        )}
      </div>
      <div className="hud-safe absolute right-0 bottom-0 flex items-end gap-3 pb-24">
        <button
          className="h-16 w-16 rounded-full border border-white/25 bg-white/10 text-xs tracking-widest text-white/70 active:bg-white/30"
          {...hold(touch.setBrakeLeft)}
        >
          AB·L
        </button>
        <button
          className="h-16 w-16 rounded-full border border-white/25 bg-white/10 text-xs tracking-widest text-white/70 active:bg-white/30"
          {...hold(touch.setBrakeRight)}
        >
          AB·R
        </button>
        <button
          className="h-24 w-24 touch-none rounded-full border-2 border-(--color-neon) bg-(--color-neon)/15 text-sm font-bold tracking-widest text-(--color-neon) active:bg-(--color-neon)/40"
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            thrustY.current = e.clientY
            touch.setThrust(true)
            touch.setRetro(false)
          }}
          onPointerMove={(e) => {
            if (thrustY.current === null) return
            // T156: pull BACK (drag down) past 26px → retro brake
            const pullingBack = e.clientY - thrustY.current > 26
            touch.setThrust(!pullingBack)
            touch.setRetro(pullingBack)
          }}
          onPointerUp={() => {
            thrustY.current = null
            touch.setThrust(false)
            touch.setRetro(false)
          }}
          onPointerCancel={() => {
            thrustY.current = null
            touch.setThrust(false)
            touch.setRetro(false)
          }}
        >
          THRUST
          <span className="block text-[8px] tracking-[0.2em] text-white/50">▼ PULL = BRAKE</span>
        </button>
      </div>
      <button
        className="hud-safe pointer-events-auto absolute top-3 right-3 rounded border border-white/20 bg-black/40 px-3 py-1 text-xs tracking-widest text-white/60"
        onClick={() => touch.fireCamera()}
      >
        CAM
      </button>
    </div>
  )
}
