import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { GpuCanvas } from '../scene/GpuCanvas'
import { ShipMesh } from '../scene/ShipMesh'
import { BUILTIN_SONGS } from '../lib/audio/builtin'
import { BUNDLED_SONGS, getBundledMeta, type BundledMeta, type BundledSong } from '../lib/audio/bundled'
import { startBuiltinRace, startBundledRace, startFileRace, startLibraryRace } from '../game/flow'
import { useGame } from '../game/store'

/** T34: peak bars rendered as one SVG, used as card background */
function Waveform({ peaks, color }: { peaks: number[]; color: string }) {
  return (
    <svg
      viewBox={`0 0 ${peaks.length} 32`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-30"
      aria-hidden
    >
      {peaks.map((p, i) => (
        <rect key={i} x={i + 0.15} y={16 - p * 14} width={0.7} height={Math.max(1, p * 28)} fill={color} />
      ))}
    </svg>
  )
}

function BundledCard({ song }: { song: BundledSong }) {
  const [meta, setMeta] = useState<BundledMeta | null>(null)
  useEffect(() => {
    let alive = true
    getBundledMeta(song.url).then((m) => alive && setMeta(m)).catch(() => {})
    return () => {
      alive = false
    }
  }, [song.url])

  return (
    <button
      className="group relative -skew-x-6 overflow-hidden border border-(--color-neon)/40 bg-black/60 px-6 py-4 text-left transition hover:border-(--color-neon) hover:bg-(--color-neon)/10 hover:shadow-[0_0_30px_rgba(47,243,255,0.25)]"
      onClick={() => void startBundledRace(song.url, song.title)}
    >
      {meta && <Waveform peaks={meta.waveform} color="#2ff3ff" />}
      <span className="relative text-xl font-bold tracking-[0.25em] text-white group-hover:text-(--color-neon)">
        {song.title}
      </span>
      <span className="relative float-right mt-1 text-sm tabular-nums text-white/40">
        {meta?.durationLabel ?? '…'}
      </span>
      <div className="absolute bottom-0 left-0 h-0.5 w-0 bg-(--color-neon) transition-all duration-300 group-hover:w-full" />
    </button>
  )
}

function SpinningShip() {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.elapsedTime * 0.6
    ref.current.position.y = Math.sin(clock.elapsedTime * 1.4) * 0.12
  })
  return (
    <group ref={ref} rotation={[0.12, 0, 0]} scale={0.7} position={[3.6, 1.6, -2]}>
      <ShipMesh />
    </group>
  )
}

export function Menu() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const settings = useGame((s) => s.settings)
  const setSettings = useGame((s) => s.setSettings)
  const userSongs = useGame((s) => s.userSongs)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      await startFileRace(file)
    } catch (e) {
      useGame.getState().setScreen('menu')
      setError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="relative h-full">
      <GpuCanvas camera={{ position: [0, 1.2, 5], fov: 50 }}>
        <color attach="background" args={['#05060f']} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[4, 6, 3]} intensity={2.2} color="#bfd8ff" />
        <pointLight position={[-4, -2, 2]} intensity={8} color="#ff2fd6" />
        <SpinningShip />
      </GpuCanvas>

      <div className="hud-safe absolute inset-0 flex items-center justify-center overflow-y-auto">
        <div className="flex w-full max-w-2xl flex-col gap-5 px-6 py-8">
          <div className="text-center">
            <h1
              className="text-6xl font-bold tracking-[0.35em] text-(--color-neon)"
              style={{ textShadow: '0 0 30px rgba(47,243,255,0.7), 0 0 80px rgba(47,243,255,0.3)' }}
            >
              WAVE RIDER
            </h1>
            <p className="mt-2 text-xs tracking-[0.6em] text-(--color-neon-2)/80">YOUR MUSIC IS THE TRACK</p>
          </div>

          <div className="mt-2 flex flex-col gap-2.5">
            <p className="text-[11px] tracking-[0.4em] text-white/35">SELECT FREQUENCY</p>
            {BUNDLED_SONGS.map((song) => (
              <BundledCard key={song.id} song={song} />
            ))}
            <button
              className="-skew-x-6 border border-dashed border-(--color-neon-2)/60 px-6 py-3.5 tracking-[0.25em] text-(--color-neon-2) transition hover:bg-(--color-neon-2)/10 hover:shadow-[0_0_30px_rgba(255,47,214,0.2)]"
              onClick={() => fileInput.current?.click()}
            >
              ▲ UPLOAD YOUR OWN TRACK
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            {error && <p className="text-center text-sm text-red-400">{error}</p>}
          </div>

          {userSongs.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] tracking-[0.4em] text-white/35">YOUR FREQUENCIES</p>
              {userSongs.map((song) => (
                <button
                  key={song.id}
                  className="group relative -skew-x-6 overflow-hidden border border-(--color-neon-2)/40 bg-black/60 px-6 py-3 text-left transition hover:border-(--color-neon-2) hover:bg-(--color-neon-2)/10"
                  onClick={() => void startLibraryRace(song.id)}
                >
                  <Waveform peaks={song.waveform} color="#ff2fd6" />
                  <span className="relative text-base font-bold tracking-[0.2em] text-white group-hover:text-(--color-neon-2)">
                    {song.title}
                  </span>
                  <span className="relative float-right mt-0.5 text-xs tabular-nums text-white/40">
                    {song.bpm} BPM · {song.durationLabel}
                  </span>
                </button>
              ))}
            </div>
          )}

          <details className="group">
            <summary className="cursor-pointer list-none text-[11px] tracking-[0.4em] text-white/25 transition hover:text-white/50">
              ▸ DEBUG FREQUENCIES (SYNTH)
            </summary>
            <div className="mt-2 flex gap-2">
              {BUILTIN_SONGS.map((song) => (
                <button
                  key={song.id}
                  className="-skew-x-6 flex-1 border border-white/10 bg-black/40 px-3 py-2 text-xs tracking-widest text-white/50 transition hover:border-white/40 hover:text-white"
                  onClick={() => void startBuiltinRace(song)}
                >
                  {song.title}
                  <span className="block text-[10px] text-white/30">{song.bpm} BPM</span>
                </button>
              ))}
            </div>
          </details>

          <div className="mt-1 flex items-center justify-between border-t border-white/10 pt-4 text-xs tracking-widest text-white/50">
            <label className="flex items-center gap-2">
              FX
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.fxIntensity}
                onChange={(e) => setSettings({ fxIntensity: Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-2">
              QUALITY
              <select
                className="border border-white/20 bg-black px-2 py-1"
                value={settings.quality}
                onChange={(e) => setSettings({ quality: e.target.value as 'low' | 'medium' | 'high' })}
              >
                <option value="low">LOW</option>
                <option value="medium">MED</option>
                <option value="high">HIGH</option>
              </select>
            </label>
            <span className="hidden text-white/30 sm:inline">WASD · SHIFT/SPACE AIRBRAKE · C CAM</span>
          </div>
        </div>
      </div>
    </div>
  )
}
