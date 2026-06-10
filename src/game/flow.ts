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

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

export async function startBuiltinRace(spec: SongSpec): Promise<void> {
  const game = useGame.getState()
  game.setScreen('analyzing')
  game.setAnalysis(0.05)
  await nextFrame()

  const pcm = renderSong(spec)
  game.setAnalysis(0.4)
  await nextFrame()

  const features = analyzeAudio(pcm, ANALYSIS_SR)
  game.setAnalysis(0.85)
  await nextFrame()

  const track = generateTrack(features)
  const songBuffer = pcmToAudioBuffer(pcm, audioContext())
  game.setAnalysis(1)
  useGame.getState().loadRace({ features, track, songBuffer, songTitle: spec.title })
}

export async function startBundledRace(url: string, title: string): Promise<void> {
  const game = useGame.getState()
  game.setScreen('analyzing')
  game.setAnalysis(0.05)
  await nextFrame()

  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load bundled song: HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  await raceFromBytes(bytes, title)
}

export async function startFileRace(file: File): Promise<void> {
  const game = useGame.getState()
  game.setScreen('analyzing')
  game.setAnalysis(0.05)
  await nextFrame()

  const bytes = await file.arrayBuffer()
  await raceFromBytes(bytes, file.name.replace(/\.[^.]+$/, '').toUpperCase())
}

async function raceFromBytes(bytes: ArrayBuffer, title: string): Promise<void> {
  const game = useGame.getState()
  const pcm = await decodeForAnalysis(bytes)
  game.setAnalysis(0.35)
  await nextFrame()

  const features = analyzeAudio(pcm, ANALYSIS_SR)
  game.setAnalysis(0.75)
  await nextFrame()

  const track = generateTrack(features)
  const songBuffer = await decodeForPlayback(bytes, audioContext())
  game.setAnalysis(1)
  useGame.getState().loadRace({ features, track, songBuffer, songTitle: title })
}
