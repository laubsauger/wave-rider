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
  /** T35: >0 counting down, (-1,0] = GO flash window */
  countdown: number
  /** T39: onset beat spike 1→0, decays fast */
  beat: number
  /** current section index under the player */
  sectionIndex: number
  /** T48: world x,z pairs — [0]=player, then NPCs */
  racersXZ: Float32Array
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
  countdown: 0,
  beat: 0,
  sectionIndex: 0,
  racersXZ: new Float32Array(12),
}
