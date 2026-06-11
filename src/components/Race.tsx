import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { GpuCanvas } from '../scene/GpuCanvas'
import { RaceScene } from '../scene/RaceScene'
import { Effects } from '../scene/Effects'
import { Hud } from './Hud'
import { TouchControls } from './TouchControls'
import { RotateOverlay } from './RotateOverlay'
import { onGameKey } from '../game/input'
import { telemetry } from '../game/telemetry'
import { audioContext, setMuted } from '../lib/audio/playback'
import { requestFullscreen } from '../lib/fullscreen'
import { saveSongToDevice } from '../lib/recents'

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
  // T181: session bytes exist for uploads AND for songs received over MP —
  // the joiner can keep the host's track
  const songBytes = useGame((s) => s.userSongs.find((u) => u.title === s.songTitle)?.bytes)
  const [songSaved, setSongSaved] = useState(false)

  // loading veil: hold black until the scene is ACTUALLY rendering — wait
  // for N real rendered frames (telemetry.frameStart advances per render),
  // not a wall-clock guess that mobile compile times blow straight past
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    setRevealed(false)
    let raf = 0
    let seen = 0
    let last = -1
    const t0 = performance.now()
    const check = () => {
      if (telemetry.frameStart !== last) {
        last = telemetry.frameStart
        seen++
      }
      if (seen >= 8 && performance.now() - t0 > 450) setRevealed(true)
      else raf = requestAnimationFrame(check)
    }
    raf = requestAnimationFrame(check)
    return () => cancelAnimationFrame(raf)
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
        camera={{ fov: 62, near: 0.1, far: 2800, position: [0, 4, 10] }}
        dpr={quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2}
        shadows={quality === 'high'}
        antialias={quality === 'high'}
      >
        <RaceScene key={runId} track={track} paused={paused} quality={quality} />
        {/* C7: low tier drops the post chain entirely; medium drops DoF */}
        <Effects fxIntensity={quality === 'low' ? 0 : fxIntensity} dof={quality === 'high'} />
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
      {/* pause: top-center under the progress bar — clear of the TIME chip
          and the touch zones; Esc still works on keyboard */}
      <button
        className="absolute top-16 left-1/2 z-30 -translate-x-1/2 rounded border border-white/20 bg-black/40 px-4 py-1.5 text-sm tracking-widest text-white/60 hover:bg-white/10 short:top-11 short:px-3 short:py-1"
        onClick={() => setPaused(true)}
      >
        ❚❚
      </button>
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
        <div className="hud-safe absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 overflow-y-auto bg-black/70 p-4 short:gap-3">
          <h2 className="text-3xl font-bold tracking-[0.4em] text-(--color-neon) short:text-xl">PAUSED</h2>
          {/* quality switchable mid-race — dpr + effects react live */}
          <div className="flex items-center gap-2 text-xs tracking-widest text-white/50">
            QUALITY
            {(['low', 'medium', 'high'] as const).map((q) => (
              <button
                key={q}
                className={`border px-3 py-1 tracking-widest short:px-2 ${
                  quality === q
                    ? 'border-(--color-neon) text-(--color-neon)'
                    : 'border-white/20 text-white/50 hover:bg-white/10'
                }`}
                onClick={() => setSettings({ quality: q })}
              >
                {q.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex max-w-full flex-wrap justify-center gap-3 short:gap-2">
            <button
              className="border border-(--color-neon) px-6 py-2 tracking-widest text-(--color-neon) hover:bg-(--color-neon)/15 short:px-4 short:py-1.5"
              onClick={() => setPaused(false)}
            >
              RESUME
            </button>
            <button
              className="border border-(--color-amber-hud) px-6 py-2 tracking-widest text-(--color-amber-hud) hover:bg-(--color-amber-hud)/15 short:px-4 short:py-1.5"
              onClick={() => {
                setRunId((r) => r + 1)
                setPaused(false)
              }}
            >
              RESTART
            </button>
            <button
              className="border border-white/30 px-6 py-2 tracking-widest text-white/60 hover:bg-white/10 short:px-4 short:py-1.5"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
                else void requestFullscreen()
              }}
            >
              ⛶ FULLSCREEN
            </button>
            {songBytes && (
              <button
                className="border border-(--color-neon-2)/50 px-6 py-2 tracking-widest text-(--color-neon-2) hover:bg-(--color-neon-2)/15 short:px-4 short:py-1.5"
                onClick={() => {
                  saveSongToDevice(songTitle, songBytes)
                  setSongSaved(true)
                }}
              >
                {songSaved ? '✓ SAVED' : '⬇ SAVE SONG'}
              </button>
            )}
            <button
              className="border border-white/30 px-6 py-2 tracking-widest text-white/60 hover:bg-white/10 short:px-4 short:py-1.5"
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
