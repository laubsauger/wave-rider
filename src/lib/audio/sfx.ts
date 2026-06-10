/**
 * T89: synthesized SFX — no assets. Countdown beeps, GO chord, and a
 * continuous engine loop whose pitch/grit ride speed + throttle.
 */
import { audioContext } from './playback'

export function beep(freq: number, dur = 0.12, gain = 0.25, type: OscillatorType = 'square'): void {
  const ctx = audioContext()
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(gain, ctx.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + dur + 0.02)
}

export function goChord(): void {
  beep(660, 0.5, 0.22, 'square')
  beep(990, 0.5, 0.18, 'square')
  beep(1320, 0.7, 0.12, 'sawtooth')
}

export interface EngineSound {
  update(v: number, thrust: number, boost: number): void
  stop(): void
}

export function startEngine(): EngineSound {
  const ctx = audioContext()
  const oscA = ctx.createOscillator()
  const oscB = ctx.createOscillator()
  const lp = ctx.createBiquadFilter()
  const g = ctx.createGain()
  oscA.type = 'sawtooth'
  oscB.type = 'sawtooth'
  oscB.detune.value = 14
  lp.type = 'lowpass'
  lp.frequency.value = 300
  lp.Q.value = 2
  g.gain.value = 0
  oscA.connect(lp)
  oscB.connect(lp)
  lp.connect(g).connect(ctx.destination)
  oscA.start()
  oscB.start()

  let dead = false
  return {
    update(v, thrust, boost) {
      if (dead) return
      const t = ctx.currentTime
      const hz = 38 + v * 0.45 + boost * 40
      oscA.frequency.setTargetAtTime(hz, t, 0.06)
      oscB.frequency.setTargetAtTime(hz * 1.005, t, 0.06)
      lp.frequency.setTargetAtTime(220 + v * 4 + thrust * 500 + boost * 1200, t, 0.08)
      g.gain.setTargetAtTime(0.015 + thrust * 0.05 + Math.min(0.03, v / 4000) + boost * 0.04, t, 0.1)
    },
    stop() {
      if (dead) return
      dead = true
      g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15)
      oscA.stop(ctx.currentTime + 0.6)
      oscB.stop(ctx.currentTime + 0.6)
    },
  }
}
