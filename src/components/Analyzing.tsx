import { useGame } from '../game/store'

const STAGES = [
  [0.2, 'DECODING WAVEFORM'],
  [0.5, 'EXTRACTING RHYTHM'],
  [0.9, 'SCULPTING TRACK'],
  [1.01, 'IGNITION'],
] as const

export function Analyzing() {
  const progress = useGame((s) => s.analysisProgress)
  const stage = STAGES.find(([p]) => progress < p)?.[1] ?? 'IGNITION'

  return (
    <div className="hud-safe relative flex h-full flex-col items-center justify-center">
      <div className="glass-panel flex flex-col items-center gap-8 px-12 py-10 short:gap-4 short:px-8 short:py-5">
      <div className="flex items-end gap-1.5">
        {Array.from({ length: 24 }, (_, i) => (
          <div
            key={i}
            className="w-2 animate-[pulse-glow_0.8s_ease-in-out_infinite] bg-(--color-neon)"
            style={{
              height: 8 + Math.abs(Math.sin(i * 1.7)) * 48,
              animationDelay: `${i * 60}ms`,
              opacity: i / 24 <= progress ? 1 : 0.15,
            }}
          />
        ))}
      </div>
      <p className="animate-pulse text-sm tracking-[0.5em] text-white/60">{stage}</p>
      </div>
    </div>
  )
}
