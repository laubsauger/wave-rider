import { useRef, useState } from 'react'
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

const MOOD_COLORS: Record<string, string> = {
  aggressive: '#ff3355',
  energetic: '#3d7bff',
  flowing: '#2fffb0',
  chill: '#b09aff',
}

/** T94: bpm / mood / intensity chips, shown wherever a track is listed */
function TrackChips({ bpm, mood, intensity }: { bpm?: number; mood?: string; intensity?: number }) {
  return (
    <span className="relative ml-2 inline-flex items-center gap-1.5 align-middle text-[9px] tracking-[0.18em]">
      {bpm !== undefined && (
        <span className="rounded-sm border border-white/15 bg-black/60 px-1 py-px text-white/55">{bpm} BPM</span>
      )}
      {mood && (
        <span
          className="rounded-sm border bg-black/60 px-1 py-px font-bold"
          style={{ color: MOOD_COLORS[mood] ?? '#fff', borderColor: (MOOD_COLORS[mood] ?? '#fff') + '55' }}
        >
          {mood.toUpperCase()}
        </span>
      )}
      {intensity !== undefined && (
        <span className="rounded-sm border border-white/15 bg-black/60 px-1 py-px text-white/55">
          INT {Math.round(intensity * 100)}
        </span>
      )}
    </span>
  )
}

function BundledCard({ song }: { song: BundledSong }) {
  // T93: pregen sidecar renders instantly; hover fallback only when absent
  const [meta, setMeta] = useState<BundledMeta | null>(song.meta ?? null)
  const requested = useRef(!!song.meta)
  const loadMeta = () => {
    if (requested.current) return
    requested.current = true
    getBundledMeta(song.url).then(setMeta).catch(() => {})
  }

  return (
    <button
      className="group relative -skew-x-6 overflow-hidden border border-(--color-neon)/40 bg-black/60 px-6 py-4 text-left transition hover:border-(--color-neon) hover:bg-(--color-neon)/10 hover:shadow-[0_0_30px_rgba(47,243,255,0.25)]"
      onPointerEnter={loadMeta}
      onFocus={loadMeta}
      onClick={() => void startBundledRace(song.url, song.title)}
    >
      {meta && <Waveform peaks={meta.waveform} color="#2ff3ff" />}
      <span className="relative block text-xl font-bold tracking-[0.25em] text-white group-hover:text-(--color-neon)">
        {song.title}
      </span>
      {song.artist && (
        <span className="relative block text-[10px] tracking-[0.35em] text-white/35">
          {song.artist}
          <TrackChips bpm={song.meta?.bpm} mood={song.meta?.mood} intensity={song.meta?.intensity} />
        </span>
      )}
      <span className="relative float-right mt-1 text-sm tabular-nums text-white/40">
        {meta?.durationLabel ?? '…'}
      </span>
      <div className="absolute bottom-0 left-0 h-0.5 w-0 bg-(--color-neon) transition-all duration-300 group-hover:w-full" />
    </button>
  )
}

/** T54: three hull variants staggered in the hangar, slow drift */
const SHOWCASE: { pos: [number, number, number]; scale: number; accent: string; variant: 0 | 1 | 2; phase: number }[] = [
  { pos: [3.6, 1.0, -2.2], scale: 0.58, accent: '#2ff3ff', variant: 0, phase: 0 },
  { pos: [5.2, -0.3, -4.2], scale: 0.5, accent: '#ff2fd6', variant: 1, phase: 2.1 },
  { pos: [4.4, -1.7, -3.2], scale: 0.42, accent: '#b4ff39', variant: 2, phase: 4.2 },
]

function ShowcaseShips() {
  const refs = useRef<(THREE.Group | null)[]>([])
  // T95: redistribute per aspect — wide: right column; narrow: arc above
  useFrame(({ clock, viewport }) => {
    const wide = viewport.aspect > 1.1
    SHOWCASE.forEach((s, i) => {
      const g = refs.current[i]
      if (!g) return
      const base: [number, number, number] = wide
        ? s.pos
        : [(i - 1) * 2.0, 2.6 - i * 0.55, -3.5 - i]
      g.position.x = base[0]
      g.position.z = base[2]
      g.scale.setScalar(wide ? s.scale : s.scale * 0.7)
      g.rotation.y = clock.elapsedTime * 0.45 + s.phase
      g.position.y = base[1] + Math.sin(clock.elapsedTime * 1.2 + s.phase) * 0.1
    })
  })
  return (
    <>
      {SHOWCASE.map((s, i) => (
        <group
          key={i}
          ref={(g) => void (refs.current[i] = g)}
          rotation={[0.14, 0, 0]}
          scale={s.scale}
          position={s.pos}
        >
          <ShipMesh accent={s.accent} variant={s.variant} />
        </group>
      ))}
    </>
  )
}

export function Menu() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const settings = useGame((s) => s.settings)
  const setSettings = useGame((s) => s.setSettings)
  const userSongs = useGame((s) => s.userSongs)
  const ghostPlayback = useGame((s) => s.ghostPlayback)

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
        {/* T54: key + rim + fill hangar lighting */}
        <ambientLight intensity={0.35} />
        <directionalLight position={[5, 7, 4]} intensity={3} color="#dfeaff" />
        <directionalLight position={[-6, 2, -4]} intensity={1.6} color="#2ff3ff" />
        <pointLight position={[-3, -2, 2]} intensity={14} color="#ff2fd6" />
        <pointLight position={[6, 3, -3]} intensity={10} color="#2ff3ff" />
        <ShowcaseShips />
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
              className="-skew-x-6 border border-dashed border-(--color-neon-2)/60 px-6 py-8 text-lg tracking-[0.25em] text-(--color-neon-2) transition hover:bg-(--color-neon-2)/10 hover:shadow-[0_0_30px_rgba(255,47,214,0.2)]"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const file = e.dataTransfer.files?.[0]
                if (file) void onFile(file)
              }}
            >
              ▲ UPLOAD OR DROP AUDIO FILE
            </button>
            {ghostPlayback && (
              <p className="text-center text-xs tracking-widest text-[#2ff3ff]">GHOST REPLAY LOADED</p>
            )}
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
                    {song.durationLabel}
                  </span>
                  <TrackChips bpm={song.bpm} mood={song.mood} intensity={song.intensity} />
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
