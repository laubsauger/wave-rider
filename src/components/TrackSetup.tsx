import { useGame } from '../game/store'
import { fmtDuration } from '../lib/audio/waveform'
import { requestFullscreen } from '../lib/fullscreen'
import { TrackChips } from './TrackChips'

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

export function TrackSetup() {
  const { songTitle, features, startRace, setMultiplayer, setGhostPlayback, track } = useGame()

  if (!features || !track) return null

  // Extract a 100-bin waveform from features.energy array
  const bins = 100
  const peaks = new Array(bins).fill(0)
  if (features.energy.length > 0) {
    const step = features.energy.length / bins
    for (let i = 0; i < bins; i++) {
      let max = 0
      const start = Math.floor(i * step)
      const end = Math.floor((i + 1) * step)
      for (let j = start; j < end && j < features.energy.length; j++) {
        max = Math.max(max, features.energy[j])
      }
      peaks[i] = max
    }
  }

  const handlePlaySolo = async () => {
    await requestFullscreen()
    if (!useGame.getState().ghostPlayback) {
      setGhostPlayback(null)
    }
    setMultiplayer(false)
    startRace()
  }

  const handleHostMultiplayer = async () => {
    await requestFullscreen()
    if (!useGame.getState().ghostPlayback) {
      setGhostPlayback(null)
    }
    setMultiplayer(true, true)
    useGame.getState().setScreen('multiplayer-lobby')
  }

  const handleCancel = () => {
    useGame.getState().setScreen('menu')
  }

  return (
    <div className="hud-safe absolute inset-0 flex flex-col items-center justify-center overflow-y-auto p-8 text-white short:justify-start short:p-2">
      <div className="glass-panel my-auto flex w-full max-w-xl flex-col items-center px-8 py-8 short:my-1 short:px-4 short:py-2">
      <h1 className="mb-8 text-4xl font-bold tracking-[0.2em] text-(--color-neon) short:mb-3 short:text-2xl">TRACK SETUP</h1>

      <div className="relative -skew-x-6 w-full max-w-lg overflow-hidden border border-(--color-neon-2)/40 bg-black/60 px-6 py-6 shadow-[0_0_30px_rgba(255,47,214,0.15)] short:px-4 short:py-3">
        <Waveform peaks={peaks} color="#ff2fd6" />
        <div className="relative">
          <p className="text-[11px] tracking-[0.4em] text-white/35">SELECTED TRACK</p>
          <h2 className="mt-1 text-2xl font-bold tracking-[0.2em] text-white short:text-lg">
            {songTitle}
            <TrackChips bpm={Math.round(features.bpm)} mood={features.mood} intensity={features.intensity} />
          </h2>
          <div className="mt-2 flex justify-between text-xs tabular-nums text-white/40">
            <span>{Math.round(features.bpm)} BPM</span>
            <span>{fmtDuration(features.duration)}</span>
          </div>
        </div>
      </div>

      <div className="mt-8 flex w-full max-w-lg flex-col gap-4 short:mt-3 short:gap-2">
        {useGame.getState().isMultiplayer ? (
          <button
            className="-skew-x-6 border border-solid border-[#b4ff39]/60 px-6 py-4 tracking-[0.25em] short:py-2 text-[#b4ff39] transition hover:bg-[#b4ff39]/10 hover:shadow-[0_0_30px_rgba(180,255,57,0.2)]"
            onClick={async () => {
              await requestFullscreen()
              startRace()
            }}
          >
            ▶ JOIN RACE
          </button>
        ) : (
          <>
            <button
              className="-skew-x-6 border border-solid border-[#2ff3ff]/60 px-6 py-4 tracking-[0.25em] short:py-2 text-[#2ff3ff] transition hover:bg-[#2ff3ff]/10 hover:shadow-[0_0_30px_rgba(47,243,255,0.2)]"
              onClick={() => void handlePlaySolo()}
            >
              {useGame.getState().ghostPlayback ? '▶ RACE GHOST' : '▶ PLAY SOLO'}
            </button>
            {!useGame.getState().ghostPlayback && (
              <button
                className="-skew-x-6 border border-solid border-[#b4ff39]/60 px-6 py-4 tracking-[0.25em] short:py-2 text-[#b4ff39] transition hover:bg-[#b4ff39]/10 hover:shadow-[0_0_30px_rgba(180,255,57,0.2)]"
                onClick={() => void handleHostMultiplayer()}
              >
                ◎ HOST MULTIPLAYER
              </button>
            )}
          </>
        )}
        <button
          className="-skew-x-6 mt-2 border border-dashed border-white/20 px-6 py-3 text-sm tracking-[0.25em] text-white/40 transition hover:border-white/50 hover:bg-white/5 hover:text-white short:mt-1 short:py-1.5"
          onClick={handleCancel}
        >
          CANCEL
        </button>
      </div>
      </div>
    </div>
  )
}
