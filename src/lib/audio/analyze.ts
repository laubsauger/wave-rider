/**
 * Pure audio feature extraction (T2). Operates on raw mono PCM so it is
 * deterministic and testable off-browser (C5, C6, V1).
 * Browser decode lives in decode.ts.
 */
import { fftMag, hann } from '../fft'

export type Mood = 'aggressive' | 'energetic' | 'flowing' | 'chill'

export interface AudioSection {
  /** start time in seconds */
  start: number
  /** end time in seconds */
  end: number
  /** mean normalized energy 0..1 */
  energy: number
  /** mean normalized spectral centroid 0..1 */
  brightness: number
}

export interface AudioFeatures {
  duration: number
  sampleRate: number
  bpm: number
  /** per-frame RMS energy, normalized 0..1 */
  energy: Float32Array
  /** per-frame spectral centroid, normalized 0..1 */
  centroid: Float32Array
  /** seconds between frames */
  frameInterval: number
  /** onset times in seconds (spectral flux peaks) */
  onsets: number[]
  sections: AudioSection[]
  mood: Mood
  /** overall 0..1 intensity, drives theme + difficulty */
  intensity: number
}

const FRAME = 2048
const HOP = 1024

export function analyzeAudio(pcm: Float32Array, sampleRate: number): AudioFeatures {
  if (pcm.length < FRAME * 4) throw new Error('audio too short to analyze')
  const duration = pcm.length / sampleRate
  const frameInterval = HOP / sampleRate
  const frameCount = Math.floor((pcm.length - FRAME) / HOP) + 1

  const energy = new Float32Array(frameCount)
  const centroid = new Float32Array(frameCount)
  const flux = new Float32Array(frameCount)
  let prevMags: Float32Array | null = null

  const re = new Float32Array(FRAME)
  const im = new Float32Array(FRAME)

  for (let f = 0; f < frameCount; f++) {
    const off = f * HOP
    re.set(pcm.subarray(off, off + FRAME))
    im.fill(0)

    // RMS before windowing
    let sum = 0
    for (let i = 0; i < FRAME; i++) sum += re[i] * re[i]
    energy[f] = Math.sqrt(sum / FRAME)

    hann(re)
    const mags = fftMag(re, im)

    let magSum = 0
    let weighted = 0
    let fl = 0
    for (let i = 0; i < mags.length; i++) {
      magSum += mags[i]
      weighted += mags[i] * i
      if (prevMags) {
        const d = mags[i] - prevMags[i]
        if (d > 0) fl += d
      }
    }
    centroid[f] = magSum > 1e-9 ? weighted / magSum / mags.length : 0
    flux[f] = fl
    prevMags = mags.slice()
  }

  normalize(energy)
  normalize(centroid)
  normalize(flux)

  const onsets = pickOnsets(flux, frameInterval)
  const bpm = estimateBpm(flux, frameInterval)
  const sections = segment(energy, centroid, frameInterval, duration)

  const meanEnergy = mean(energy)
  const meanCentroid = mean(centroid)
  const intensity = clamp01(0.55 * meanEnergy + 0.25 * meanCentroid + 0.2 * clamp01((bpm - 70) / 110))
  const mood = classifyMood(bpm, meanEnergy, meanCentroid)

  return { duration, sampleRate, bpm, energy, centroid, frameInterval, onsets, sections, mood, intensity }
}

function normalize(a: Float32Array): void {
  let max = 0
  for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i]
  if (max > 1e-9) for (let i = 0; i < a.length; i++) a[i] /= max
}

function mean(a: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return a.length ? s / a.length : 0
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/** Peak-pick spectral flux: local max above adaptive threshold, min 100ms apart. */
function pickOnsets(flux: Float32Array, frameInterval: number): number[] {
  const onsets: number[] = []
  const w = 8
  let lastOnset = -1
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] <= flux[i - 1] || flux[i] < flux[i + 1]) continue
    let local = 0
    let n = 0
    for (let j = Math.max(0, i - w); j < Math.min(flux.length, i + w); j++) {
      local += flux[j]
      n++
    }
    const threshold = (local / n) * 1.3 + 0.02
    if (flux[i] < threshold) continue
    const t = i * frameInterval
    if (lastOnset >= 0 && t - lastOnset < 0.1) continue
    onsets.push(t)
    lastOnset = t
  }
  return onsets
}

/** Autocorrelation of onset envelope, 60–180 bpm search range. */
function estimateBpm(flux: Float32Array, frameInterval: number): number {
  const minLag = Math.round(60 / 180 / frameInterval)
  const maxLag = Math.round(60 / 60 / frameInterval)
  const corrAt = (lag: number): number => {
    let corr = 0
    for (let i = 0; i + lag < flux.length; i++) corr += flux[i] * flux[i + lag]
    return corr / (flux.length - lag)
  }
  let bestLag = minLag
  let bestCorr = -Infinity
  for (let lag = minLag; lag <= maxLag && lag < flux.length; lag++) {
    const corr = corrAt(lag)
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }
  // V11 octave fix: autocorr peaks equally at 2× the beat period; prefer the
  // faster octave when its correlation is nearly as strong (B1).
  while (bestLag >= 2 * minLag && corrAt(Math.round(bestLag / 2)) >= 0.72 * bestCorr) {
    bestLag = Math.round(bestLag / 2)
    bestCorr = corrAt(bestLag)
  }
  return Math.round((60 / (bestLag * frameInterval)) * 10) / 10
}

/**
 * Change-point sectioning: novelty = difference of adjacent window means over
 * (energy, centroid). Peaks above threshold split sections; min length 8s.
 */
function segment(
  energy: Float32Array,
  centroid: Float32Array,
  frameInterval: number,
  duration: number,
): AudioSection[] {
  const win = Math.max(4, Math.round(4 / frameInterval)) // 4s windows
  const novelty = new Float32Array(energy.length)
  for (let i = win; i < energy.length - win; i++) {
    let eA = 0, eB = 0, cA = 0, cB = 0
    for (let j = 0; j < win; j++) {
      eA += energy[i - win + j]
      eB += energy[i + j]
      cA += centroid[i - win + j]
      cB += centroid[i + j]
    }
    novelty[i] = Math.abs(eB - eA) / win + Math.abs(cB - cA) / win
  }

  const minGap = Math.round(8 / frameInterval)
  const cuts: number[] = []
  for (let i = 1; i < novelty.length - 1; i++) {
    if (novelty[i] > 0.12 && novelty[i] >= novelty[i - 1] && novelty[i] > novelty[i + 1]) {
      if (cuts.length === 0 || i - cuts[cuts.length - 1] >= minGap) cuts.push(i)
    }
  }

  const bounds = [0, ...cuts.map((c) => c * frameInterval), duration]
  const sections: AudioSection[] = []
  for (let s = 0; s < bounds.length - 1; s++) {
    const start = bounds[s]
    const end = bounds[s + 1]
    if (end - start < 1) continue
    const i0 = Math.floor(start / frameInterval)
    const i1 = Math.min(energy.length, Math.floor(end / frameInterval))
    let e = 0, c = 0
    const n = Math.max(1, i1 - i0)
    for (let i = i0; i < i1; i++) {
      e += energy[i]
      c += centroid[i]
    }
    sections.push({ start, end, energy: e / n, brightness: c / n })
  }
  if (sections.length === 0) {
    sections.push({ start: 0, end: duration, energy: mean(energy), brightness: mean(centroid) })
  }
  return sections
}

function classifyMood(bpm: number, energy: number, brightness: number): Mood {
  // peak-normalized energy means cluster ~0.3–0.5 even for loud material,
  // so thresholds sit lower than intuition suggests
  const drive = energy * 0.6 + clamp01((bpm - 80) / 100) * 0.4
  if (drive > 0.4) return bpm >= 135 || brightness > 0.42 ? 'aggressive' : 'energetic'
  if (drive > 0.28) return 'flowing'
  return 'chill'
}
