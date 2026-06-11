export const MOOD_COLORS: Record<string, string> = {
  aggressive: '#ff3355',
  energetic: '#3d7bff',
  flowing: '#2fffb0',
  chill: '#b09aff',
}

/** T94: bpm / mood / intensity chips, shown wherever a track is listed */
export function TrackChips({ bpm, mood, intensity }: { bpm?: number; mood?: string; intensity?: number }) {
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
