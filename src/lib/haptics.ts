/**
 * T152: mobile haptics — thin wrapper over the Vibration API. No-op on
 * desktop / unsupported browsers. Callers gate on fxIntensity (V10 spirit:
 * feedback intensity is user-scalable).
 */
export function buzz(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch {
      /* some browsers throw on weird patterns — feedback is best-effort */
    }
  }
}

export const haptics = {
  /** rising double-tap — reads as a kick, not a phone notification */
  boost: () => buzz([12, 24, 30]),
  wall: (impact: number) => buzz(Math.min(110, 35 + impact * 2)),
  wreck: () => buzz([70, 30, 110, 40, 60]),
  /** touchdown thump, scaled by vertical impact */
  land: (impact: number) => buzz(Math.min(60, 12 + impact * 1.2)),
  /** short tick — re-fired ~every 150ms while grinding a wall */
  grind: () => buzz(14),
  countTick: () => buzz(18),
  go: () => buzz([24, 30, 50]),
}
