import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { GpuCanvas } from '../scene/GpuCanvas'
import { ShipMesh } from '../scene/ShipMesh'
import { BUILTIN_SONGS } from '../lib/audio/builtin'
import { BUNDLED_SONGS, getBundledMeta, type BundledMeta, type BundledSong } from '../lib/audio/bundled'
import { startBuiltinRace, startBundledRace, startFileRace, startLibraryRace } from '../game/flow'
import { useGame } from '../game/store'
import { setMuted } from '../lib/audio/playback'

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
      className="group relative -skew-x-6 overflow-hidden border border-(--color-neon)/40 bg-black/60 px-6 py-4 text-left short:px-4 short:py-2 transition hover:border-(--color-neon) hover:bg-(--color-neon)/10 hover:shadow-[0_0_30px_rgba(47,243,255,0.25)]"
      onPointerEnter={loadMeta}
      onFocus={loadMeta}
      onClick={() => void startBundledRace(song.url, song.artist ? `${song.artist} — ${song.title}` : song.title)}
    >
      {meta && <Waveform peaks={meta.waveform} color="#2ff3ff" />}
      <span className="relative block text-xl font-bold tracking-[0.25em] text-white group-hover:text-(--color-neon) short:text-sm">
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

const FLASH_ACK_KEY = 'wave-rider-flash-ack'

/** T102: photosensitivity notice — must be acknowledged once before play */
function FlashWarning({ onAck }: { onAck: () => void }) {
  // T129: short copy — the old paragraph clipped on landscape phones
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <div className="glass-panel max-h-full max-w-md overflow-y-auto border border-(--color-amber-hud)/40 p-6 text-center short:p-4">
        <p className="text-lg font-bold tracking-[0.3em] text-(--color-amber-hud) short:text-base">⚠ FLASHING LIGHTS</p>
        <p className="mt-3 text-sm leading-relaxed text-white/70 short:mt-2 short:text-xs">
          Contains flashing lights and color pulses synced to music — may affect photosensitive
          players. Stop if you feel dizzy. The FX slider can reduce or disable these effects.
        </p>
        <button
          className="mt-4 border border-(--color-neon) px-8 py-2 tracking-[0.3em] text-(--color-neon) hover:bg-(--color-neon)/15 short:mt-3 short:py-1.5"
          onClick={onAck}
        >
          I UNDERSTAND
        </button>
      </div>
    </div>
  )
}

export function Menu() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const settings = useGame((s) => s.settings)
  const setSettings = useGame((s) => s.setSettings)
  const userSongs = useGame((s) => s.userSongs)
  const [flashAcked, setFlashAcked] = useState(() => localStorage.getItem(FLASH_ACK_KEY) === '1')
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
      {!flashAcked && (
        <FlashWarning
          onAck={() => {
            localStorage.setItem(FLASH_ACK_KEY, '1')
            setFlashAcked(true)
          }}
        />
      )}
      {/* T144: backdrop lives in the App-level persistent canvas now — this
          one is a transparent overlay carrying only the ship showcase */}
      <GpuCanvas alpha camera={{ position: [0, 1.2, 5], fov: 50 }}>
        {/* T54: key + rim + fill hangar lighting */}
        <ambientLight intensity={0.35} />
        <directionalLight position={[5, 7, 4]} intensity={3} color="#dfeaff" />
        <directionalLight position={[-6, 2, -4]} intensity={1.6} color="#2ff3ff" />
        <pointLight position={[-3, -2, 2]} intensity={14} color="#ff2fd6" />
        <pointLight position={[6, 3, -3]} intensity={10} color="#2ff3ff" />
        <ShowcaseShips />
      </GpuCanvas>

      {/* T147: short viewports anchor to TOP and scroll — centering tall
          content on a 360px-high phone cut off both ends */}
      <div className="hud-safe absolute inset-0 flex items-center justify-center overflow-y-auto short:items-start">
        <div className="glass-panel my-6 flex w-full max-w-2xl flex-col gap-5 px-6 py-8 short:my-2 short:max-w-xl short:gap-2 short:px-3 short:py-3">
          <div className="text-center">
            <h1
              className="text-6xl font-bold tracking-[0.35em] text-(--color-neon) short:text-3xl"
              style={{ textShadow: '0 0 30px rgba(47,243,255,0.7), 0 0 80px rgba(47,243,255,0.3)' }}
            >
              WAVE RIDER
            </h1>
            <p className="mt-2 text-xs tracking-[0.6em] text-(--color-neon-2)/80 short:mt-1 short:text-[10px]">YOUR MUSIC IS THE TRACK</p>
          </div>

          <div className="mt-2 flex flex-col gap-2.5 short:mt-0 short:gap-1.5">
            <p className="text-[11px] tracking-[0.4em] text-white/35">SELECT FREQUENCY</p>
            {BUNDLED_SONGS.map((song) => (
              <BundledCard key={song.id} song={song} />
            ))}
            <button
              className="-skew-x-6 border border-dashed border-(--color-neon-2)/60 px-6 py-8 text-lg short:py-3 short:text-sm tracking-[0.25em] text-(--color-neon-2) transition hover:bg-(--color-neon-2)/10 hover:shadow-[0_0_30px_rgba(255,47,214,0.2)]"
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
            <button
              className="border border-white/20 px-2 py-1 tracking-widest hover:bg-white/10"
              onClick={() => {
                const m = !settings.muted
                setSettings({ muted: m })
                setMuted(m)
              }}
            >
              {settings.muted ? '🔇 MUTED' : '🔊 SOUND'}
            </button>
            <span className="hidden text-white/30 sm:inline">WASD · SHIFT/SPACE AIRBRAKE · C CAM</span>
          </div>
          <div className="mt-8 flex justify-center gap-6 text-white/40">
            <a
              href="https://www.instagram.com/floflup"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-[#ff2fd6] hover:drop-shadow-[0_0_8px_rgba(255,47,214,0.8)]"
              aria-label="Instagram"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16.11 7.5v.01"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>
            </a>
            <a
              href="https://github.com/laubsauger"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-white hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]"
              aria-label="GitHub"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
            </a>
            <a
              href="https://www.youtube.com/@laub69"
              target="_blank"
              rel="noopener noreferrer"
              className="transition hover:text-[#ff0000] hover:drop-shadow-[0_0_8px_rgba(255,0,0,0.8)]"
              aria-label="YouTube"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/></svg>
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
