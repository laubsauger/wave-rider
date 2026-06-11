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
  boost: () => buzz(35),
  wall: (impact: number) => buzz(Math.min(90, 25 + impact * 1.5)),
  wreck: () => buzz([60, 40, 100]),
}
