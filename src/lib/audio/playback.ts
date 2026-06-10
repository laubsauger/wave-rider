/**
 * Song playback during race (T9). One shared AudioContext; song time derives
 * from ctx.currentTime so it never drifts from the hardware clock.
 */
let ctx: AudioContext | null = null

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

export interface SongHandle {
  /** seconds into the song, clock-accurate */
  time: () => number
  stop: (fadeSeconds?: number) => void
  onEnded: (fn: () => void) => void
}

export function playSong(buffer: AudioBuffer): SongHandle {
  const ac = audioContext()
  void ac.resume()
  const src = ac.createBufferSource()
  src.buffer = buffer
  const gain = ac.createGain()
  gain.gain.value = 0.9
  src.connect(gain).connect(ac.destination)
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
  }
}
