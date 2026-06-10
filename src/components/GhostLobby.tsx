import { useGame } from '../game/store'
import { startBundledRace } from '../game/flow'
import { BUNDLED_SONGS } from '../lib/audio/bundled'
import { useRef } from 'react'
import { startFileRace } from '../game/flow'

export function GhostLobby() {
  const ghost = useGame((s) => s.ghostPlayback)
  const fileInput = useRef<HTMLInputElement>(null)

  if (!ghost) return null

  const isBuiltin = BUNDLED_SONGS.some((s) => s.title === ghost.songTitle)

  const handlePlayGhost = async () => {
    const song = BUNDLED_SONGS.find((s) => s.title === ghost.songTitle)
    if (song) {
      await startBundledRace(song.url, song.title)
    }
  }

  const handleCustomFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      await startFileRace(file)
    }
  }

  const handleCancel = () => {
    useGame.getState().setGhostPlayback(null)
    useGame.getState().setScreen('menu')
  }

  const formatTime = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000)
    const m = Math.floor(totalSecs / 60)
    const s = totalSecs % 60
    const mss = ms % 1000
    return `${m}:${s.toString().padStart(2, '0')}.${mss.toString().padStart(3, '0')}`
  }

  return (
    <div className="hud-safe absolute inset-0 flex flex-col items-center justify-center bg-black/35 p-8 text-white">
      <h1 className="mb-8 text-4xl font-bold tracking-[0.2em] text-(--color-neon-2)">GHOST DATA FOUND</h1>

      <div className="relative w-full max-w-lg border border-(--color-neon-2)/40 bg-white/5 px-6 py-6 text-center shadow-[0_0_30px_rgba(255,47,214,0.15)]">
        <p className="text-xs tracking-[0.4em] text-white/50">TARGET TRACK</p>
        <h2 className="mt-2 text-2xl font-bold tracking-widest text-white">{ghost.songTitle}</h2>
        
        <p className="mt-6 text-xs tracking-[0.4em] text-white/50">OPPONENT TIME</p>
        <p className="mt-1 font-mono text-3xl text-(--color-neon-2)">{formatTime(ghost.timeMs ?? 0)}</p>
      </div>

      <div className="mt-8 flex w-full max-w-lg flex-col gap-4">
        {isBuiltin ? (
          <button
            className="-skew-x-6 border border-solid border-[#2ff3ff]/60 px-6 py-4 tracking-[0.25em] text-[#2ff3ff] transition hover:bg-[#2ff3ff]/10 hover:shadow-[0_0_30px_rgba(47,243,255,0.2)]"
            onClick={() => void handlePlayGhost()}
          >
            ▶ RACE GHOST
          </button>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm text-white/60">
              This ghost requires the original audio file. Please select it to race.
            </p>
            <button
              className="-skew-x-6 border border-solid border-[#ff2fd6]/60 px-6 py-4 tracking-[0.25em] text-[#ff2fd6] transition hover:bg-[#ff2fd6]/10 hover:shadow-[0_0_30px_rgba(255,47,214,0.2)]"
              onClick={() => fileInput.current?.click()}
            >
              ▲ SELECT MP3
            </button>
            <input type="file" accept="audio/*" ref={fileInput} className="hidden" onChange={(e) => void handleCustomFile(e)} />
          </div>
        )}
        <button
          className="-skew-x-6 mt-2 border border-dashed border-white/20 px-6 py-3 text-sm tracking-[0.25em] text-white/40 transition hover:border-white/50 hover:bg-white/5 hover:text-white"
          onClick={handleCancel}
        >
          CANCEL
        </button>
      </div>
    </div>
  )
}
