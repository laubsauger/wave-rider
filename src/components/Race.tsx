import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { GpuCanvas } from '../scene/GpuCanvas'
import { RaceScene } from '../scene/RaceScene'
import { Effects } from '../scene/Effects'
import { Hud } from './Hud'
import { TouchControls } from './TouchControls'
import { RotateOverlay } from './RotateOverlay'
import { onGameKey } from '../game/input'
import { audioContext } from '../lib/audio/playback'

export function Race() {
  const track = useGame((s) => s.track)
  const fxIntensity = useGame((s) => s.settings.fxIntensity)
  const quality = useGame((s) => s.settings.quality)
  const setScreen = useGame((s) => s.setScreen)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    return onGameKey((e) => {
      if (e === 'pause') setPaused((p) => !p)
    })
  }, [])

  // C3: on touch devices, go fullscreen + lock landscape for the race.
  // Best-effort — browsers that refuse still get the V4 rotate overlay.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return
    const el = document.documentElement
    void el.requestFullscreen?.().then(() => {
      type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> }
      return (screen.orientation as LockableOrientation).lock?.('landscape')
    }).catch(() => {})
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  useEffect(() => {
    const ctx = audioContext()
    if (paused) void ctx.suspend()
    else void ctx.resume()
  }, [paused])

  if (!track) return null

  return (
    <div className="relative h-full">
      <GpuCanvas
        camera={{ fov: 62, near: 0.1, far: 6000, position: [0, 4, 10] }}
        dpr={quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2}
        shadows={quality === 'high'}
      >
        <RaceScene track={track} paused={paused} quality={quality} />
        {/* C7: low tier drops the post chain entirely */}
        <Effects fxIntensity={quality === 'low' ? 0 : fxIntensity} />
      </GpuCanvas>
      <Hud accent={track.theme.edge} track={track} />
      <TouchControls />
      {paused && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black/70">
          <h2 className="text-3xl font-bold tracking-[0.4em] text-(--color-neon)">PAUSED</h2>
          <div className="flex gap-4">
            <button
              className="border border-(--color-neon) px-6 py-2 tracking-widest text-(--color-neon) hover:bg-(--color-neon)/15"
              onClick={() => setPaused(false)}
            >
              RESUME
            </button>
            <button
              className="border border-white/30 px-6 py-2 tracking-widest text-white/60 hover:bg-white/10"
              onClick={() => setScreen('menu')}
            >
              QUIT
            </button>
          </div>
        </div>
      )}
      <RotateOverlay />
    </div>
  )
}
