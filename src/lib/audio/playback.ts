/**
 * Song playback during race (T9). One shared AudioContext; song time derives
 * from ctx.currentTime so it never drifts from the hardware clock.
 */
let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

/**
 * Master bus — everything audible (song, sfx, engine) routes through here so
 * mute is one gain. Muting must NOT touch the context clock: song time is the
 * race sync source (V9).
 */
export function masterBus(): GainNode {
  if (!master) {
    master = audioContext().createGain()
    master.gain.value = muted ? 0 : 1
    master.connect(audioContext().destination)
  }
  return master
}

export function setMuted(m: boolean): void {
  muted = m
  if (master) master.gain.value = m ? 0 : 1
}

export function isMuted(): boolean {
  return muted
}

export interface SongHandle {
  /** seconds into the song, clock-accurate */
  time: () => number
  stop: (fadeSeconds?: number) => void
  onEnded: (fn: () => void) => void
  /** T113: music IS the engine — 0 = half volume idle, 1 = full send */
  setIntensity: (v: number) => void
}

export function playSong(buffer: AudioBuffer): SongHandle {
  const ac = audioContext()
  void ac.resume()
  const src = ac.createBufferSource()
  src.buffer = buffer
  const gain = ac.createGain()
  gain.gain.value = 0.45 // T113: idles at half, throttle opens it up
  src.connect(gain).connect(masterBus())
  const startedAt = ac.currentTime
  src.start()

  return {
    time: () => Math.min(buffer.duration, ac.currentTime - startedAt),
    stop: (fadeSeconds = 0.8) => {
      const now = ac.currentTime
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds)
      src.stop(now + fadeSeconds + 0.05)
    },
    onEnded: (fn) => {
      src.onended = fn
    },
    setIntensity: (v) => {
      const clamped = Math.min(1, Math.max(0, v))
      gain.gain.setTargetAtTime(0.45 + clamped * 0.5, ac.currentTime, 0.15)
    },
  }
}
