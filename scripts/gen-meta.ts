/**
 * T93: pregen bundled-track meta (waveform/duration/bpm/mood/intensity) into
 * audio/<name>.meta.json — committed, so the menu is rich with zero mp3
 * download on page load. Run: npx vite-node scripts/gen-meta.ts
 */
import decode from 'audio-decode'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeAudio } from '../src/lib/audio/analyze'
import { computeWaveform, fmtDuration } from '../src/lib/audio/waveform'

const dir = join(process.cwd(), 'audio')
for (const f of readdirSync(dir)) {
  if (!/\.(mp3|wav|ogg|m4a)$/i.test(f)) continue
  const bytes = readFileSync(join(dir, f))
  // node build of audio-decode returns { channelData: Float32Array[], sampleRate }
  const buf = (await decode(new Uint8Array(bytes))) as unknown as {
    channelData: Float32Array[]
    sampleRate: number
  }
  const chans = buf.channelData
  const len = chans[0].length
  const mono = new Float32Array(len)
  for (const ch of chans) {
    for (let i = 0; i < len; i++) mono[i] += ch[i] / chans.length
  }
  console.log(f, 'decoded', len, 'samples @', buf.sampleRate)
  if (len < buf.sampleRate * 10) {
    console.warn('SKIP (too short / decode issue):', f)
    continue
  }
  const feats = analyzeAudio(mono, buf.sampleRate)
  const meta = {
    waveform: computeWaveform(mono),
    durationLabel: fmtDuration(len / buf.sampleRate),
    bpm: Math.round(feats.bpm),
    mood: feats.mood,
    intensity: Math.round(feats.intensity * 100) / 100,
  }
  writeFileSync(join(dir, f.replace(/\.[^.]+$/, '.meta.json')), JSON.stringify(meta))
  console.log(f, '→ bpm', meta.bpm, meta.mood, 'int', meta.intensity, meta.durationLabel)
}
