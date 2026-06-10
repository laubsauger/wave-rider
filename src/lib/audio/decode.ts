/**
 * Browser-side decode (T2, C6). Analysis PCM always decoded at a fixed
 * 44100Hz mono via OfflineAudioContext so the same file produces the same
 * features on every device (V1).
 */
export const ANALYSIS_SR = 44100

export async function decodeForAnalysis(data: ArrayBuffer): Promise<Float32Array> {
  const oc = new OfflineAudioContext(1, 1, ANALYSIS_SR)
  const buf = await oc.decodeAudioData(data.slice(0))
  return downmix(buf)
}

/** Decode at playback quality for the race soundtrack. */
export async function decodeForPlayback(data: ArrayBuffer, ctx: AudioContext): Promise<AudioBuffer> {
  return ctx.decodeAudioData(data.slice(0))
}

export function downmix(buf: AudioBuffer): Float32Array {
  const out = new Float32Array(buf.length)
  const n = buf.numberOfChannels
  for (let c = 0; c < n; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / n
  }
  return out
}
