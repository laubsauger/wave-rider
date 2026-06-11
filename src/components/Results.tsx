import { useState } from 'react'
import { useGame } from '../game/store'
import { serializeGhost } from '../lib/network/ghost'
import { network } from '../lib/network/p2p'
import { saveSongToDevice } from '../lib/recents'

function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function Results() {
  const result = useGame((s) => s.result)
  const track = useGame((s) => s.track)
  const setScreen = useGame((s) => s.setScreen)
  const isMultiplayer = useGame((s) => s.isMultiplayer)
  const opponentFinished = useGame((s) => s.opponentFinished)
  const opponentTimeMs = useGame((s) => s.opponentTimeMs)
  const ghostData = useGame((s) => s.ghostData)
  // T181: keep the track — bytes live in the session library for uploads and
  // for the song the host streamed over (the joiner's only copy)
  const songTitle = useGame((s) => s.songTitle)
  const songBytes = useGame((s) => s.userSongs.find((u) => u.title === s.songTitle)?.bytes)

  const [copied, setCopied] = useState(false)
  const [songSaved, setSongSaved] = useState(false)

  if (!result || !track) return null

  const accent = track.theme.edge

  return (
    <div className="hud-safe relative flex h-full flex-col items-center justify-center overflow-y-auto p-6 short:justify-start short:p-2">
      <div className="glass-panel my-auto flex w-full max-w-xl flex-col items-center gap-8 px-8 py-10 short:my-1 short:gap-3 short:px-4 short:py-3">
      <p className="text-xs tracking-[0.5em] text-white/40">{result.songTitle}</p>
      <h2 className="text-4xl font-bold tracking-[0.4em] short:text-2xl" style={{ color: accent, textShadow: `0 0 24px ${accent}` }}>
        FINISH
      </h2>
      <div
        className="text-7xl font-bold tabular-nums short:text-4xl"
        style={{ color: result.place === 1 ? '#ffd23d' : accent, textShadow: '0 0 30px currentColor' }}
      >
        {result.place}
        <span className="text-2xl text-white/40 short:text-lg">/{result.totalRacers}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-lg short:gap-x-10 short:gap-y-1 short:text-sm">
        <span className="text-white/50">TIME</span>
        <span className="text-right font-bold tabular-nums">{fmtTime(result.timeMs)}</span>
        <span className="text-white/50">TOP SPEED</span>
        <span className="text-right font-bold tabular-nums">{Math.round(result.topSpeed * 3.6)} KPH</span>
        <span className="text-white/50">BOOSTS</span>
        <span className="text-right font-bold tabular-nums">{result.boostsHit}</span>
        <span className="text-white/50">WALL HITS</span>
        <span className="text-right font-bold tabular-nums">{result.wallHits}</span>
        
        {isMultiplayer && (
          <>
            <span className="text-[#b4ff39]/80 mt-4 short:mt-1">OPPONENT TIME</span>
            <span className="text-right font-bold tabular-nums text-[#b4ff39] mt-4 short:mt-1">
              {opponentFinished && opponentTimeMs ? fmtTime(opponentTimeMs) : 'RACING...'}
            </span>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 short:gap-2">
        <button
          className="border px-6 py-2 tracking-widest transition hover:bg-white/10"
          style={{ borderColor: accent, color: accent }}
          onClick={() => setScreen('race')}
        >
          RACE AGAIN
        </button>
        <button
          className="border border-white/30 px-6 py-2 tracking-widest text-white/60 transition hover:bg-white/10"
          onClick={() => {
            if (isMultiplayer) network.disconnect()
            useGame.getState().setMultiplayer(false)
            useGame.getState().setGhostPlayback(null)
            setScreen('menu')
          }}
        >
          MENU
        </button>
        {songBytes && (
          <button
            className="border border-(--color-neon-2)/50 px-6 py-2 tracking-widest text-(--color-neon-2) transition hover:bg-(--color-neon-2)/15"
            onClick={() => {
              saveSongToDevice(songTitle, songBytes)
              setSongSaved(true)
            }}
          >
            {songSaved ? '✓ SAVED' : '⬇ SAVE SONG'}
          </button>
        )}
        {typeof navigator !== 'undefined' && !!navigator.share && (
          <button
            className="flex items-center gap-2 border border-white/30 px-6 py-2 tracking-widest text-white/60 transition hover:bg-white/10"
            onClick={() => {
              navigator.share({
                title: 'Wave Rider',
                text: `I just placed ${result.place}/${result.totalRacers} with a time of ${fmtTime(result.timeMs)} on ${result.songTitle} in Wave Rider!`,
                url: window.location.origin + window.location.pathname,
              }).catch(() => {})
            }}
          >
            SHARE
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
          </button>
        )}
      </div>
      
      {ghostData && !isMultiplayer && (
        <button
          className="mt-4 border border-[#2ff3ff]/40 px-6 py-2 tracking-widest text-[#2ff3ff]/80 transition hover:bg-[#2ff3ff]/10 short:mt-0"
          onClick={async () => {
            const str = await serializeGhost(ghostData)
            const url = `${window.location.origin}${window.location.pathname}?ghost=${str}`
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'LINK COPIED!' : 'COPY GHOST LINK'}
        </button>
      )}
      </div>
    </div>
  )
}
