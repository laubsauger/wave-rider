import { useEffect, useState } from 'react'

/**
 * V4: portrait on a touch device blocks gameplay behind a rotate prompt.
 * CSS orientation media query drives it; gameplay continues underneath but
 * is unreachable until landscape.
 */
export function RotateOverlay() {
  const [portrait, setPortrait] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (pointer: coarse)')
    const update = () => setPortrait(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (!portrait) return null
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-(--color-void)">
      <div className="animate-[spin_3s_ease-in-out_infinite] text-6xl">📱</div>
      <p className="text-xl tracking-[0.25em] text-(--color-neon)">ROTATE TO LANDSCAPE</p>
    </div>
  )
}
