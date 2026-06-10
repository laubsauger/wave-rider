/**
 * Fixed-timestep accumulator (V5, C9). Render dt feeds in; sim always steps
 * in exact PHYSICS_DT quanta. Step count is a pure function of accumulated
 * time, never of frame boundaries.
 */
import { PHYSICS_DT } from './ship'

export interface Accumulator {
  acc: number
}

export const MAX_FRAME_DT = 0.25 // clamp tab-switch spikes

/** Returns number of fixed steps to run for this frame. Mutates accumulator. */
export function accumulateSteps(state: Accumulator, frameDt: number): number {
  state.acc += Math.min(MAX_FRAME_DT, Math.max(0, frameDt))
  const steps = Math.floor(state.acc / PHYSICS_DT)
  state.acc -= steps * PHYSICS_DT
  return steps
}

/** Interpolation alpha for rendering between previous and current sim state. */
export function alpha(state: Accumulator): number {
  return state.acc / PHYSICS_DT
}
