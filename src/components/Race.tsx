import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { GpuCanvas } from '../scene/GpuCanvas'
import { RaceScene } from '../scene/RaceScene'
import { Effects } from '../scene/Effects'
import { Hud } from './Hud'
import { TouchControls } from './TouchControls'
import { RotateOverlay } from './RotateOverlay'
import { onGameKey } from '../game/input'
import { audioContext, setMuted } from '../lib/audio/playback'
import { requestFullscreen } from '../lib/fullscreen'

export function Race() {
  const track = useGame((s) => s.track)
  const fxIntensity = useGame((s) => s.settings.fxIntensity)
  const quality = useGame((s) => s.settings.quality)
  const muted = useGame((s) => s.settings.muted)
  const setSettings = useGame((s) => s.setSettings)
  const setScreen = useGame((s) => s.setScreen)
  const [paused, setPaused] = useState(false)
  // restart = remount the scene: fresh sim, countdown, song
  const [runId, setRunId] = useState(0)
  const songTitle = useGame((s) => s.songTitle)

  // loading veil: hold black while the scene compiles/warms (the README-text-
  // on-black second), then fade the world in — no pop-in jank
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    setRevealed(false)
    let raf = 0
    const t = setTimeout(() => {
      // two rAFs after the timeout ≈ first real rendered frames
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => setRevealed(true))
      })
    }, 450)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(raf)
    }
  }, [runId])

  useEffect(() => {
    return onGameKey((e) => {
      if (e === 'pause') setPaused((p) => !p)
      if (e === 'mute') {
        const m = !useGame.getState().settings.muted
        setSettings({ muted: m })
        setMuted(m)
      }
    })
  }, [setSettings])

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
        <RaceScene key={runId} track={track} paused={paused} quality={quality} />
        {/* C7: low tier drops the post chain entirely */}
        <Effects fxIntensity={quality === 'low' ? 0 : fxIntensity} />
      </GpuCanvas>
      <Hud accent={track.theme.edge} track={track} />
      {/* master mute — M key or click */}
      <button
        className="absolute right-3 bottom-3 z-30 border border-white/25 px-2.5 py-1 text-[10px] tracking-widest text-white/60 hover:bg-white/10"
        onClick={() => {
          const m = !muted
          setSettings({ muted: m })
          setMuted(m)
        }}
      >
        {muted ? '🔇 MUTED' : '🔊 MUTE'}
      </button>
      <TouchControls />
      {/* loading veil — fades out once the scene is actually drawing */}
      <div
        className={`pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black transition-opacity duration-700 ${revealed ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="text-center">
          <p className="animate-pulse text-2xl font-bold tracking-[0.4em] text-white/80">{songTitle}</p>
          <p className="mt-2 text-[10px] tracking-[0.5em] text-white/35">BUILDING TRACK</p>
        </div>
      </div>
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
              className="border border-(--color-amber-hud) px-6 py-2 tracking-widest text-(--color-amber-hud) hover:bg-(--color-amber-hud)/15"
              onClick={() => {
                setRunId((r) => r + 1)
                setPaused(false)
              }}
            >
              RESTART
            </button>
            <button
              className="border border-white/30 px-6 py-2 tracking-widest text-white/60 hover:bg-white/10"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
                else void requestFullscreen()
              }}
            >
              ⛶ FULLSCREEN
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
