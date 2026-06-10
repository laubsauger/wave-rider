import { useGame } from '../game/store'

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
  if (!result || !track) return null

  const accent = track.theme.edge

  return (
    <div className="hud-safe flex h-full flex-col items-center justify-center gap-8">
      <p className="text-xs tracking-[0.5em] text-white/40">{result.songTitle}</p>
      <h2 className="text-4xl font-bold tracking-[0.4em]" style={{ color: accent, textShadow: `0 0 24px ${accent}` }}>
        FINISH
      </h2>
      <div
        className="text-7xl font-bold tabular-nums"
        style={{ color: result.place === 1 ? '#ffd23d' : accent, textShadow: '0 0 30px currentColor' }}
      >
        {result.place}
        <span className="text-2xl text-white/40">/{result.totalRacers}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-12 gap-y-3 text-lg">
        <span className="text-white/50">TIME</span>
        <span className="text-right font-bold tabular-nums">{fmtTime(result.timeMs)}</span>
        <span className="text-white/50">TOP SPEED</span>
        <span className="text-right font-bold tabular-nums">{Math.round(result.topSpeed * 3.6)} KPH</span>
        <span className="text-white/50">BOOSTS</span>
        <span className="text-right font-bold tabular-nums">{result.boostsHit}</span>
        <span className="text-white/50">WALL HITS</span>
        <span className="text-right font-bold tabular-nums">{result.wallHits}</span>
      </div>
      <div className="flex gap-4">
        <button
          className="border px-6 py-2 tracking-widest transition hover:bg-white/10"
          style={{ borderColor: accent, color: accent }}
          onClick={() => setScreen('race')}
        >
          RACE AGAIN
        </button>
        <button
          className="border border-white/30 px-6 py-2 tracking-widest text-white/60 transition hover:bg-white/10"
          onClick={() => setScreen('menu')}
        >
          MENU
        </button>
      </div>
    </div>
  )
}
