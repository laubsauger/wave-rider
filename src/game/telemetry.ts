/**
 * Mutable per-frame race telemetry. Scene writes, HUD reads via its own rAF
 * and writes DOM directly — no React re-render per frame.
 */
export interface RaceTelemetry {
  speed: number
  /** 0..1 along track */
  progress: number
  timeMs: number
  boost: number
  songTime: number
  /** current audio energy 0..1 for HUD pulse */
  energy: number
  wallFlash: number
  boostFlash: number
  /** live race rank, 1-based (V13) */
  position: number
  racers: number
}

export const telemetry: RaceTelemetry = {
  speed: 0,
  progress: 0,
  timeMs: 0,
  boost: 0,
  songTime: 0,
  energy: 0,
  wallFlash: 0,
  boostFlash: 0,
  position: 1,
  racers: 1,
}
