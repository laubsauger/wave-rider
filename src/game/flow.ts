/**
 * Menu → analysis → race pipeline (T11). Heavy sync work is yielded behind
 * rAF ticks so the analyzing screen paints between stages.
 */
import { useGame } from './store'
import { analyzeAudio } from '../lib/audio/analyze'
import { decodeForAnalysis, decodeForPlayback, ANALYSIS_SR } from '../lib/audio/decode'
import { pcmToAudioBuffer, renderSong, type SongSpec } from '../lib/audio/builtin'
import { generateTrack } from '../lib/track/generate'
import { audioContext } from '../lib/audio/playback'
import { computeWaveform, fmtDuration } from '../lib/audio/waveform'

// B11: rAF never fires in occluded/background tabs — racing a timeout keeps
// the analysis pipeline moving even when the user tabs away
const nextFrame = () =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 120)
    requestAnimationFrame(() => {
      clearTimeout(timer)
      resolve()
    })
  })

export async function startBuiltinRace(spec: SongSpec): Promise<void> {
  const game = useGame.getState()
  game.setScreen('analyzing')
  game.setAnalysis(0.32) // no download for synths — skip straight past that stage
  await nextFrame()

  const pcm = renderSong(spec)
  game.setAnalysis(0.6)
  await nextFrame()

  const features = analyzeAudio(pcm, ANALYSIS_SR)
  game.setAnalysis(0.85)
  await nextFrame()

  const track = generateTrack(features)
  const songBuffer = pcmToAudioBuffer(pcm, audioContext())
  game.setAnalysis(1)
  useGame.getState().setupRace({ features, track, songBuffer, songTitle: spec.title })
}

export async function startBundledRace(url: string, title: string): Promise<void> {
  const game = useGame.getState()
  game.setScreen('analyzing')
  game.setAnalysis(0.05)
  await nextFrame()

  try {
    // streamed download with REAL progress (0.05 → 0.30) — these files run
    // tens of MB and a frozen bar on mobile reads as "broken"
    const res = await fetch(url)
    if (!res.ok) throw new Error(`could not load bundled song: HTTP ${res.status}`)
    let bytes: ArrayBuffer
    const total = Number(res.headers.get('content-length') || 0)
    if (res.body && total > 0) {
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let got = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        got += value.byteLength
        game.setAnalysis(0.05 + (got / total) * 0.25)
      }
      const all = new Uint8Array(got)
      let off = 0
      for (const c of chunks) {
        all.set(c, off)
        off += c.byteLength
      }
      bytes = all.buffer
    } else {
      game.setAnalysis(0.18)
      bytes = await res.arrayBuffer()
    }
    game.setAnalysis(0.3)
    await raceFromBytes(bytes, title)
  } catch (e) {
    // never strand the user on the analyzing screen
    console.error('bundled song load failed', e)
    useGame.getState().setScreen('menu')
  }
}

export async function startFileRace(file: File): Promise<void> {
  const game = useGame.getState()
  game.setScreen('analyzing')
  game.setAnalysis(0.32) // local file — no download stage
  await nextFrame()

  const bytes = await file.arrayBuffer()
  await raceFromBytes(bytes, file.name.replace(/\.[^.]+$/, '').toUpperCase(), true)
}

/** replay an uploaded song from the session library (T34) */
export async function startLibraryRace(songId: string): Promise<void> {
  const song = useGame.getState().userSongs.find((s) => s.id === songId)
  if (!song) throw new Error(`unknown library song: ${songId}`)
  const game = useGame.getState()
  game.setScreen('analyzing')
  game.setAnalysis(0.32) // in-memory bytes — no download stage
  await nextFrame()
  await raceFromBytes(song.bytes.slice(0), song.title, false)
}

async function raceFromBytes(bytes: ArrayBuffer, title: string, addToLibrary = false): Promise<void> {
  const game = useGame.getState()
  const pcm = await decodeForAnalysis(bytes)
  game.setAnalysis(0.55)
  await nextFrame()

  const features = analyzeAudio(pcm, ANALYSIS_SR)
  game.setAnalysis(0.85)
  await nextFrame()

  const track = generateTrack(features)
  const songBuffer = await decodeForPlayback(bytes, audioContext())
  game.setAnalysis(1)

  if (addToLibrary) {
    useGame.getState().addUserSong({
      id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title,
      bpm: Math.round(features.bpm),
      mood: features.mood,
      intensity: Math.round(features.intensity * 100) / 100,
      durationLabel: fmtDuration(features.duration),
      waveform: computeWaveform(pcm),
      bytes: bytes.slice(0),
    })
  }
  useGame.getState().setupRace({ features, track, songBuffer, songTitle: title })
}
