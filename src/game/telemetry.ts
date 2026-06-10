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
  /** T35: >3.5 READY, 3..1 digits, (-1,0] = GO flash window. Init 9 = READY — 0 would flash GO on mount (B24) */
  countdown: number
  /** T39: onset beat spike 1→0, decays fast */
  beat: number
  /** T57: spectral brightness 0..1 — hats/highs proxy */
  centroid: number
  /** current section index under the player */
  sectionIndex: number
  /** T88: opponent's last reported status line (downloading/analyzing) */
  oppStatus: string
  /** T48/T49: world x,y,z triplets — [0]=player, then NPCs */
  racersXZ: Float32Array
  /** P2P synchronization state */
  syncState: 'waiting' | 'ready'
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
  countdown: 9,
  beat: 0,
  centroid: 0,
  sectionIndex: 0,
  oppStatus: '',
  racersXZ: new Float32Array(18),
  syncState: 'ready',
}
