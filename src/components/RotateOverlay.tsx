import { useEffect, useState } from 'react'
import { requestFullscreen } from '../lib/fullscreen'

/**
 * V4: portrait on a touch device blocks gameplay behind a rotate prompt.
 * CSS orientation media query drives it; gameplay continues underneath but
 * is unreachable until landscape.
 */
export function RotateOverlay() {
  const [portrait, setPortrait] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (pointer: coarse)')
    let wasPortrait = mq.matches
    const update = () => {
      setPortrait(mq.matches)
      // T129: rotating into landscape → grab fullscreen (best effort; some
      // browsers demand a tap — the overlay tap covers those)
      if (wasPortrait && !mq.matches) void requestFullscreen()
      wasPortrait = mq.matches
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (!portrait) return null
  return (
    <div
      className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-5 bg-(--color-void)"
      onClick={() => void requestFullscreen()}
    >
      {/* T129: identity — people landing here should know what this is */}
      <p
        className="text-2xl font-bold tracking-[0.35em] text-(--color-neon)"
        style={{ textShadow: '0 0 24px rgba(47,243,255,0.6)' }}
      >
        WAVE RIDER
      </p>
      <div className="animate-[spin_3s_ease-in-out_infinite] text-5xl">📱</div>
      <p className="text-lg tracking-[0.25em] text-white/85">ROTATE TO LANDSCAPE</p>
      <p className="text-xs tracking-widest text-white/50">TAP FOR FULLSCREEN</p>
    </div>
  )
}
