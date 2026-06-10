/**
 * Deterministic track generation (T3). Pure function of AudioFeatures.
 * V1: same features → identical TrackData. V8: no Math.random — all
 * randomness from mulberry32 seeded by feature hash.
 * V2: point-to-point, track length ≅ song duration at design speed.
 * V3: bpm/energy → fast straights + tight chicanes; calm → flowing curves.
 */
import { hashFeatures, mulberry32, rngRange, type Rng } from '../prng'
import type { AudioFeatures, AudioSection, Mood } from '../audio/analyze'

export type SegmentType = 'straight' | 'curve' | 'chicane' | 'hill' | 'jump' | 'glide' | 'corkscrew'

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
  /** V19: per-section accent colors (hue-shifted theme.edge) for visual development */
  sectionPalettes: string[]
  /** T60: track roll angle (rad) per control point — corkscrew frame twist */
  rolls: number[]
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
  const width = 26 - features.intensity * 6 // intense music → narrower, scarier

  const { points, segments, rolls } = layoutCourse(features, length, rng, avgSpeed)
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
    sectionPalettes: sectionPalettes(theme.edge, features.sections),
    rolls,
  }
}

/**
 * V19: each section gets a distinct accent — hue rotated by its brightness
 * delta from the song mean, brightness scaled by section energy. Pure math
 * on hex strings, no three.js dependency.
 */
function sectionPalettes(edgeHex: string, sections: AudioSection[]): string[] {
  const meanB = sections.reduce((a, s) => a + s.brightness, 0) / Math.max(1, sections.length)
  return sections.map((sec, i) => {
    const hueShift = (sec.brightness - meanB) * 0.55 + (i % 2 === 0 ? 0.04 : -0.04)
    const lightShift = (sec.energy - 0.5) * 0.18
    return shiftHsl(edgeHex, hueShift, lightShift)
  })
}

function shiftHsl(hex: string, dHue: number, dLight: number): string {
  const n = parseInt(hex.slice(1), 16)
  let r = ((n >> 16) & 255) / 255
  let g = ((n >> 8) & 255) / 255
  let b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  h = (h + dHue + 1) % 1
  const l2 = Math.min(0.75, Math.max(0.3, l + dLight))
  const c = (1 - Math.abs(2 * l2 - 1)) * s
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1))
  const m = l2 - c / 2
  const [r2, g2, b2] =
    h < 1 / 6 ? [c, x, 0] : h < 2 / 6 ? [x, c, 0] : h < 3 / 6 ? [0, c, x] : h < 4 / 6 ? [0, x, c] : h < 5 / 6 ? [x, 0, c] : [c, 0, x]
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`
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
  roll: number
}

function layoutCourse(
  features: AudioFeatures,
  totalLength: number,
  rng: Rng,
  avgSpeed: number,
): { points: TrackPoint[]; segments: TrackSegment[]; rolls: number[] } {
  const points: TrackPoint[] = []
  const segments: TrackSegment[] = []
  const rolls: number[] = []
  const cur: Cursor = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 }
  points.push({ x: 0, y: 0, z: 0 })
  rolls.push(0)

  // T25: map song events into track space at design pace
  const drops = features.events
    .filter((e) => e.type === 'drop')
    .map((e) => ({ s: e.start * avgSpeed, strength: Math.max(0.5, e.strength), used: false }))
  const breakdowns = features.events
    .filter((e) => e.type === 'breakdown')
    .map((e) => ({ s0: e.start * avgSpeed, s1: e.end * avgSpeed }))

  let s = 0
  const sectionLengths = features.sections.map(
    (sec) => ((sec.end - sec.start) / features.duration) * totalLength,
  )

  // V20/B10: curvature must scale with design speed — target max lateral
  // accel ~50 m/s² at the reference max curve k of 0.012
  const kScale = Math.min(1, 50 / (avgSpeed * avgSpeed * 0.012))

  for (let si = 0; si < features.sections.length; si++) {
    const sec = features.sections[si]
    const secLen = sectionLengths[si]
    const onsetDensity = onsetsPerSecond(features, sec)
    // T38: each section trends up or down — vertical separation where the
    // course crosses itself, and the skyline keeps changing
    const slopeBias = (si % 2 === 0 ? 1 : -1) * 0.014 + (sec.energy - 0.5) * 0.022
    let remaining = secLen

    while (remaining > 1) {
      let seg: SegmentPlan
      // window wide enough that a 560m segment can't step over it (T60)
      const drop = drops.find((d) => !d.used && s >= d.s - 320 && s <= d.s + 280)
      if (drop && remaining > 120) {
        drop.used = true
        // crest then cliff — the song slams, the floor disappears (V16)
        seg = { type: 'jump', length: 300 + drop.strength * 140, curvature: 0, slope: drop.strength }
      } else if (breakdowns.some((b) => s >= b.s0 && s < b.s1)) {
        // breakdown → long held glide, wide flowing line, gentle descent
        seg = {
          type: 'glide',
          length: rngRange(rng, 320, 520),
          curvature: rngRange(rng, 0.0015, 0.004) * (rng() < 0.5 ? -1 : 1) * kScale,
          slope: rngRange(rng, -0.03, -0.01),
        }
      } else {
        seg = chooseSegment(sec, onsetDensity, rng)
        seg.curvature *= kScale
        seg.slope += slopeBias
      }
      const segLen = Math.min(remaining, seg.length)
      walkSegment(cur, points, rolls, seg, segLen)
      segments.push({ type: seg.type, start: s, end: s + segLen, sectionIndex: si })
      s += segLen
      remaining -= segLen
    }
  }

  return { points, segments, rolls }
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
    // T60: barrel-roll the road itself when the music hammers
    if (onsetDensity > 1.2 && roll < 0.22) {
      return { type: 'corkscrew', length: rngRange(rng, 420, 560), curvature: 0, slope: 0 }
    }
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
      return { type: 'hill', length: rngRange(rng, 150, 260), curvature: 0, slope: rngRange(rng, 0.05, 0.12) * (rng() < 0.5 ? -1 : 1) }
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

function walkSegment(
  cur: Cursor,
  points: TrackPoint[],
  rolls: number[],
  seg: SegmentPlan,
  length: number,
): void {
  const steps = Math.max(1, Math.round(length / CTRL_SPACING))
  const ds = length / steps
  const isChicane = seg.type === 'chicane'
  const isJump = seg.type === 'jump'
  // T60: corkscrew = exactly one full 2π twist over the segment, ends upright
  const rollStep = seg.type === 'corkscrew' ? (Math.PI * 2) / steps : 0
  // T65: banked corners — roll into the curve like a velodrome
  const bankTarget =
    seg.type === 'curve' || seg.type === 'chicane'
      ? Math.max(-0.42, Math.min(0.42, seg.curvature * 170)) // B17: +k banks INTO the corner
      : 0

  for (let i = 0; i < steps; i++) {
    let k = seg.curvature
    if (isChicane) {
      // S-shape: flip curvature halfway
      k = i < steps / 2 ? seg.curvature : -seg.curvature
    }
    let slopeTarget = seg.slope
    let ease = 0.3
    if (isJump) {
      // seg.slope carries drop strength: ramp to a crest @ 28%, then a
      // catchable dive (T36: dialed back from cliff)
      const t = i / steps
      slopeTarget = t < 0.28 ? 0.08 + seg.slope * 0.05 : -0.18 * seg.slope - 0.08
      ease = 0.45
    }
    cur.heading += k * ds
    cur.pitch += (slopeTarget - cur.pitch) * ease
    cur.x += Math.sin(cur.heading) * ds
    cur.z -= Math.cos(cur.heading) * ds
    cur.y += cur.pitch * ds
    // keep track above the void floor
    if (cur.y < -130) {
      cur.y = -130
      cur.pitch = Math.max(0, cur.pitch)
    }
    if (rollStep !== 0) {
      cur.roll += rollStep
    } else {
      // ease toward bank (or back to upright), preserving full corkscrew turns
      const base = Math.round(cur.roll / (Math.PI * 2)) * Math.PI * 2
      let bank = isChicane && i >= steps / 2 ? -bankTarget : bankTarget
      if (seg.type !== 'curve' && seg.type !== 'chicane') bank = 0
      cur.roll += (base + bank - cur.roll) * 0.22
    }
    points.push({ x: cur.x, y: cur.y, z: cur.z })
    rolls.push(cur.roll)
  }
  // after a jump, level out so the landing is catchable
  if (isJump) cur.pitch *= 0.3
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
