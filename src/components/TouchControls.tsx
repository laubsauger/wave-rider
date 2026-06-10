import { useEffect, useRef } from 'react'
import { touch } from '../game/input'

/**
 * Touch layout (T6, I.ctl): left half = analog steer (drag horizontally),
 * right side = thrust + airbrake buttons. Only rendered on coarse pointers.
 */
export function TouchControls() {
  const steerZone = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const zone = steerZone.current
    if (!zone) return
    let activeId: number | null = null

    const steerFrom = (clientX: number) => {
      const rect = zone.getBoundingClientRect()
      const rel = ((clientX - rect.left) / rect.width) * 2 - 1
      touch.setSteer(rel)
    }
    const down = (e: PointerEvent) => {
      activeId = e.pointerId
      steerFrom(e.clientX)
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
        <div className="absolute bottom-6 left-6 text-xs tracking-[0.3em] text-white/30">◄ STEER ►</div>
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
          className="h-24 w-24 rounded-full border-2 border-(--color-neon) bg-(--color-neon)/15 text-sm font-bold tracking-widest text-(--color-neon) active:bg-(--color-neon)/40"
          {...hold(touch.setThrust)}
        >
          THRUST
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
