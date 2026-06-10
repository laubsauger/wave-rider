/**
 * Deterministic track generation (T3). Pure function of AudioFeatures.
 * V1: same features → identical TrackData. V8: no Math.random — all
 * randomness from mulberry32 seeded by feature hash.
 * V2: point-to-point, track length ≅ song duration at design speed.
 * V3: bpm/energy → fast straights + tight chicanes; calm → flowing curves.
 */
import { hashFeatures, mulberry32, rngRange, type Rng } from '../prng'
import type { AudioFeatures, AudioSection, Mood } from '../audio/analyze'

export type SegmentType = 'straight' | 'curve' | 'chicane' | 'hill'

export interface TrackSegment {
  type: SegmentType
  /** arc-length start/end along track, meters */
  start: number
  end: number
  sectionIndex: number
}

export interface BoostPad {
  /** arc-length position, meters */
  s: number
  /** lateral lane position -1..1 */
  lane: number
}

export interface TrackTheme {
  name: string
  /** hex colors */
  road: string
  edge: string
  glow: string
  sky: string
  fog: string
  fogDensity: number
  /** 0..1 how much env pulses with music */
  pulse: number
}

export interface TrackPoint {
  x: number
  y: number
  z: number
}

export interface TrackData {
  seed: number
  /** total arc length approximation, meters */
  length: number
  /** design speed m/s — pace at which finish aligns with song end (V2, V9) */
  avgSpeed: number
  width: number
  points: TrackPoint[]
  segments: TrackSegment[]
  boosts: BoostPad[]
  theme: TrackTheme
  mood: Mood
  duration: number
  /** per-section mean energy 0..1, indexed by TrackSegment.sectionIndex */
  sectionEnergies: number[]
}

const CTRL_SPACING = 30 // meters between spline control points

export function generateTrack(features: AudioFeatures): TrackData {
  const sectionStats = features.sections.flatMap((s) => [s.start, s.end, s.energy, s.brightness])
  const seed = hashFeatures('wave-rider-v1', [
    features.duration,
    features.bpm,
    features.intensity,
    ...sectionStats,
  ])
  const rng = mulberry32(seed)

  // V3: speed scales with bpm + intensity. 70..210 m/s feels WipEout-ish.
  const avgSpeed = 70 + features.intensity * 100 + clamp01((features.bpm - 70) / 110) * 40
  const length = avgSpeed * features.duration
  const width = 14 - features.intensity * 4 // intense music → narrower, scarier

  const { points, segments } = layoutCourse(features, length, rng)
  const boosts = placeBoosts(features, avgSpeed, length)
  const theme = pickTheme(features.mood, features.intensity)

  return {
    seed,
    length,
    avgSpeed,
    width,
    points,
    segments,
    boosts,
    theme,
    mood: features.mood,
    duration: features.duration,
    sectionEnergies: features.sections.map((s) => s.energy),
  }
}

/** Map song time → expected track position at design pace (V9 sync anchor). */
export function songTimeToS(track: TrackData, t: number): number {
  return Math.min(track.length, Math.max(0, t * track.avgSpeed))
}

export function sToSongTime(track: TrackData, s: number): number {
  return Math.min(track.duration, Math.max(0, s / track.avgSpeed))
}

interface Cursor {
  x: number
  z: number
  y: number
  heading: number
  pitch: number
}

function layoutCourse(
  features: AudioFeatures,
  totalLength: number,
  rng: Rng,
): { points: TrackPoint[]; segments: TrackSegment[] } {
  const points: TrackPoint[] = []
  const segments: TrackSegment[] = []
  const cur: Cursor = { x: 0, y: 0, z: 0, heading: 0, pitch: 0 }
  points.push({ x: 0, y: 0, z: 0 })

  let s = 0
  const sectionLengths = features.sections.map(
    (sec) => ((sec.end - sec.start) / features.duration) * totalLength,
  )

  for (let si = 0; si < features.sections.length; si++) {
    const sec = features.sections[si]
    const secLen = sectionLengths[si]
    const onsetDensity = onsetsPerSecond(features, sec)
    let remaining = secLen

    while (remaining > 1) {
      const seg = chooseSegment(sec, onsetDensity, rng)
      const segLen = Math.min(remaining, seg.length)
      walkSegment(cur, points, seg, segLen)
      segments.push({ type: seg.type, start: s, end: s + segLen, sectionIndex: si })
      s += segLen
      remaining -= segLen
    }
  }

  return { points, segments }
}

interface SegmentPlan {
  type: SegmentType
  length: number
  /** rad per meter, signed */
  curvature: number
  /** vertical slope, m per m */
  slope: number
}

/**
 * V3 mapping (documented, deterministic):
 *  - energy > 0.6: long fast straights, chicanes when onset-dense
 *  - mid energy: sweeping curves, occasional hills
 *  - low energy: wide flowing curves, gentle elevation
 */
function chooseSegment(sec: AudioSection, onsetDensity: number, rng: Rng): SegmentPlan {
  const e = sec.energy
  const roll = rng()

  if (e > 0.6) {
    if (onsetDensity > 2.5 && roll < 0.45) {
      return {
        type: 'chicane',
        length: rngRange(rng, 120, 220),
        curvature: rngRange(rng, 0.012, 0.022) * (rng() < 0.5 ? -1 : 1),
        slope: 0,
      }
    }
    if (roll < 0.75) {
      return { type: 'straight', length: rngRange(rng, 250, 450), curvature: 0, slope: rngRange(rng, -0.02, 0.02) }
    }
    return {
      type: 'curve',
      length: rngRange(rng, 150, 280),
      curvature: rngRange(rng, 0.006, 0.012) * (rng() < 0.5 ? -1 : 1),
      slope: 0,
    }
  }

  if (e > 0.3) {
    if (roll < 0.5) {
      return {
        type: 'curve',
        length: rngRange(rng, 180, 320),
        curvature: rngRange(rng, 0.004, 0.009) * (rng() < 0.5 ? -1 : 1),
        slope: rngRange(rng, -0.015, 0.015),
      }
    }
    if (roll < 0.75) {
      return { type: 'hill', length: rngRange(rng, 150, 260), curvature: 0, slope: rngRange(rng, 0.03, 0.06) * (rng() < 0.5 ? -1 : 1) }
    }
    return { type: 'straight', length: rngRange(rng, 180, 320), curvature: 0, slope: 0 }
  }

  return {
    type: 'curve',
    length: rngRange(rng, 250, 420),
    curvature: rngRange(rng, 0.002, 0.005) * (rng() < 0.5 ? -1 : 1),
    slope: rngRange(rng, -0.01, 0.01),
  }
}

function walkSegment(cur: Cursor, points: TrackPoint[], seg: SegmentPlan, length: number): void {
  const steps = Math.max(1, Math.round(length / CTRL_SPACING))
  const ds = length / steps
  const isChicane = seg.type === 'chicane'

  for (let i = 0; i < steps; i++) {
    let k = seg.curvature
    if (isChicane) {
      // S-shape: flip curvature halfway
      k = i < steps / 2 ? seg.curvature : -seg.curvature
    }
    cur.heading += k * ds
    // ease slope toward target, decay back to level
    cur.pitch += (seg.slope - cur.pitch) * 0.3
    cur.x += Math.sin(cur.heading) * ds
    cur.z -= Math.cos(cur.heading) * ds
    cur.y += cur.pitch * ds
    // keep track above floor
    if (cur.y < -40) cur.y = -40
    points.push({ x: cur.x, y: cur.y, z: cur.z })
  }
}

function onsetsPerSecond(features: AudioFeatures, sec: AudioSection): number {
  const len = Math.max(0.001, sec.end - sec.start)
  let n = 0
  for (const t of features.onsets) if (t >= sec.start && t < sec.end) n++
  return n / len
}

/** Strong onsets → boost pads at the matching track position (design pace). */
function placeBoosts(features: AudioFeatures, avgSpeed: number, length: number): BoostPad[] {
  const boosts: BoostPad[] = []
  let last = -Infinity
  for (const t of features.onsets) {
    const s = t * avgSpeed
    if (s < 150 || s > length - 100) continue
    if (s - last < 180) continue // don't carpet the road
    // deterministic lane from onset time bits
    const lane = ((Math.round(t * 1000) % 3) - 1) * 0.55
    boosts.push({ s, lane })
    last = s
  }
  return boosts
}

const THEMES: Record<Mood, TrackTheme> = {
  aggressive: {
    name: 'Redline',
    road: '#1a0b14',
    edge: '#ff2fd6',
    glow: '#ff3355',
    sky: '#1a0510',
    fog: '#2a0818',
    fogDensity: 0.0045,
    pulse: 1,
  },
  energetic: {
    name: 'Voltage',
    road: '#0a1020',
    edge: '#2ff3ff',
    glow: '#3d7bff',
    sky: '#040818',
    fog: '#081226',
    fogDensity: 0.0035,
    pulse: 0.8,
  },
  flowing: {
    name: 'Slipstream',
    road: '#0a1618',
    edge: '#b4ff39',
    glow: '#2fffb0',
    sky: '#03100e',
    fog: '#06201c',
    fogDensity: 0.003,
    pulse: 0.55,
  },
  chill: {
    name: 'Drift',
    road: '#10101e',
    edge: '#9d7bff',
    glow: '#c4a9ff',
    sky: '#0a0a1c',
    fog: '#12122a',
    fogDensity: 0.0025,
    pulse: 0.35,
  },
}

function pickTheme(mood: Mood, intensity: number): TrackTheme {
  const t = THEMES[mood]
  return { ...t, fogDensity: t.fogDensity * (0.8 + intensity * 0.4) }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}
