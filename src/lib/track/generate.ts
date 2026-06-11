/**
 * Deterministic track generation (T3). Pure function of AudioFeatures.
 * V1: same features → identical TrackData. V8: no Math.random — all
 * randomness from mulberry32 seeded by feature hash.
 * V2 (reworked): point-to-point, track length ≅ song duration at design
 * pace, where design pace = a SKILLED rider with good boost discipline.
 * Physics derives everything from it: no-boost cruise ≈ 0.75×, absolute
 * ceiling ≈ 1.36× (see ship.ts). Ride the song well → finish with the song.
 * V3: bpm/energy → fast straights + tight chicanes; calm → flowing curves.
 */
import { hashFeatures, mulberry32, rngRange, type Rng } from '../prng'
import { maxCarveCurvature } from '../physics/ship'
import type { AudioFeatures, AudioSection, Mood } from '../audio/analyze'

export type SegmentType =
  | 'straight'
  | 'curve'
  | 'chicane'
  | 'hill'
  | 'jump'
  | 'glide'
  | 'corkscrew'
  | 'speedway'
  | 'ridge'
  | 'wallride'
  | 'loop'

export interface TrackSegment {
  type: SegmentType
  /** arc-length start/end along track, meters */
  start: number
  end: number
  sectionIndex: number
  /** T77: width multiplier — speedway 1.6, ridge 0.6, else 1 */
  widthScale: number
  /** T78: false → no rails/walls, you can fall off */
  walls: boolean
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
  /**
   * T104/R9b: track-up per control point, xyz triplets. (0,1,0) everywhere
   * except vertical loops, where the analytic circle normal (toward loop
   * center) carries the frame through inversion — world-up projection
   * degenerates there.
   */
  ups: number[]
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

  // V3/V2: design pace = the pace of a SKILLED rider with boost discipline,
  // scaled by bpm + intensity → ~154..462 m/s (550-1660 kph). The old 70-210
  // base was a slow reference the ship out-cruised 1.65× by default — races
  // ended at half the song. The 2.2 factor folds the real ride pace into the
  // pace itself; ship.ts cruise/ceiling fractions are re-anchored to match
  // (actual on-track speeds are unchanged).
  const avgSpeed = (70 + features.intensity * 100 + clamp01((features.bpm - 70) / 110) * 40) * 2.2
  const length = avgSpeed * features.duration
  // T169 → wider still: carve room is the skill range — the wide road is
  // survivable everywhere, the FAST line through it is what's earned
  const width = 34 - features.intensity * 5

  const { points, segments, rolls, ups } = layoutCourse(features, length, rng, avgSpeed)
  const boosts = placeBoosts(features, avgSpeed, length)
  // T77: speedways carry dense boost rows
  for (const seg of segments) {
    if (seg.type !== 'speedway') continue
    let li = 0
    for (let bs = seg.start + 50; bs < seg.end - 50; bs += 70) {
      boosts.push({ s: bs, lane: ((li++ % 3) - 1) * 0.6 })
    }
  }
  boosts.sort((a, b) => a.s - b.s)
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
    ups,
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
): { points: TrackPoint[]; segments: TrackSegment[]; rolls: number[]; ups: number[] } {
  const points: TrackPoint[] = []
  const segments: TrackSegment[] = []
  const rolls: number[] = []
  const ups: number[] = []
  const cur: Cursor = { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0 }
  points.push({ x: 0, y: 0, z: 0 })
  rolls.push(0)
  ups.push(0, 1, 0)

  // T25: map song events into track space at design pace — the course is
  // laid out where a skilled rider will BE when the song hits
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

  // T142: whole-course elevation trend — the track climbs or sinks overall
  // so upcoming segments stack into actual vistas. Boosted ~1.5×: tracks
  // were cutting through themselves where the course re-crossed its own
  // footprint at near-identical height.
  const globalTrend = rngRange(rng, 0.006, 0.013) * (rng() < 0.5 ? -1 : 1)

  // T157: distance since the last jump ended — twist zones need a clean
  // run-in, not an airborne arrival off a crest
  let sinceJump = Infinity

  // V20/B10 → carve rework: curvature budget comes from the ship's ACTUAL
  // steering capability at no-boost cruise (~0.75× design pace, the drag
  // settle point), not a fixed lateral-accel target. Peak curves demand ~70%
  // of full-carve authority: the good line is a held carve, the lazy line
  // drifts wide across the (now wider) road, the bad line grinds the wall.
  const kScale = Math.min(1, (maxCarveCurvature(avgSpeed * 0.75) * 0.7) / 0.012)

  // T154: spectacle gates are RELATIVE to the song's own dynamics — real
  // analysis yields section energies ~0.2-0.55, half the synthetic scale the
  // absolute gates were tuned on. Every song's hottest stretch gets the show.
  const maxSecE = Math.max(0.001, ...features.sections.map((x) => x.energy))

  for (let si = 0; si < features.sections.length; si++) {
    const sec = features.sections[si]
    const secLen = sectionLengths[si]
    const onsetDensity = onsetsPerSecond(features, sec)
    const eRel = sec.energy / maxSecE
    // T38: each section trends up or down — vertical separation where the
    // course crosses itself, and the skyline keeps changing
    // T114: amplitude ↑ — the course should climb and dive, not simmer
    // T163 → amplitude up (0.03→0.05, 0.045→0.06): more vertical separation
    // between sections = self-crossings pass OVER each other, not through
    const slopeBias = (si % 2 === 0 ? 1 : -1) * 0.05 + (sec.energy - 0.5) * 0.06 + globalTrend
    let remaining = secLen

    while (remaining > 1) {
      let seg: SegmentPlan
      // window wide enough that a 560m segment can't step over it (T60)
      const drop = drops.find((d) => !d.used && s >= d.s - 320 && s <= d.s + 280)
      if (drop && remaining > 120) {
        drop.used = true
        // crest then cliff — the song slams, the floor disappears (V16).
        // T158: scaled to the track — a hop with hang time, not a ballistic arc
        seg = { type: 'jump', length: 240 + drop.strength * 90, curvature: 0, slope: drop.strength }
      } else if (breakdowns.some((b) => s >= b.s0 && s < b.s1)) {
        // breakdown → long held glide, wide flowing line, gentle descent
        seg = {
          type: 'glide',
          length: rngRange(rng, 420, 660),
          curvature: rngRange(rng, 0.0015, 0.004) * (rng() < 0.5 ? -1 : 1) * kScale,
          slope: rngRange(rng, -0.03, -0.01),
        }
      } else {
        seg = chooseSegment(sec, onsetDensity, rng, avgSpeed, eRel)
        // T157: jump → corkscrew/loop is unplayable at pace — you arrive
        // airborne over the twist entry. Demand 160m of run-in after a jump.
        if ((seg.type === 'corkscrew' || seg.type === 'loop') && sinceJump < 160) {
          seg = { type: 'straight', length: Math.min(remaining, 200), curvature: 0, slope: 0 }
        }
        if (seg.type === 'loop' && seg.length > remaining) {
          // a truncated loop would strand the cursor mid-circle — bail to a straight
          seg = { type: 'straight', length: remaining, curvature: 0, slope: 0 }
        }
        // B31: walkSegment rolls the FULL 2π over whatever length it gets —
        // a section boundary truncating a corkscrew compresses the whole
        // barrel roll into the stub: violent twist @ the seam, ship kicked.
        // Shrink to the room available if sane, else demote.
        if (seg.type === 'corkscrew' && seg.length > remaining) {
          seg = remaining >= 320
            ? { ...seg, length: remaining }
            : { type: 'straight', length: remaining, curvature: 0, slope: 0 }
        }
        seg.curvature *= kScale
        if (seg.type !== 'loop') seg.slope += slopeBias
      }
      const segLen = Math.min(remaining, seg.length)
      walkSegment(cur, points, rolls, ups, seg, segLen)
      segments.push({
        type: seg.type,
        start: s,
        end: s + segLen,
        sectionIndex: si,
        widthScale: seg.widthScale ?? 1,
        walls: seg.walls ?? true,
      })
      s += segLen
      remaining -= segLen
      sinceJump = seg.type === 'jump' ? 0 : sinceJump + segLen
    }
  }

  return { points, segments, rolls, ups }
}

interface SegmentPlan {
  type: SegmentType
  length: number
  /** rad per meter, signed */
  curvature: number
  /** vertical slope, m per m */
  slope: number
  widthScale?: number
  walls?: boolean
  /** R9b: vertical loop radius, m */
  radius?: number
  /** R9b: lateral exit shift direction so the loop clears its own entry */
  side?: 1 | -1
  /** T151: bank gain (rad per k) — energy-scaled so hot sections TILT */
  bankGain?: number
  /** T165: absolute bank target (rad) — wallrides; 1.48 ≈ the vertical face */
  bankAbs?: number
}

/**
 * V3 mapping (documented, deterministic):
 *  - energy > 0.6: long fast straights, chicanes when onset-dense
 *  - mid energy: sweeping curves, occasional hills
 *  - low energy: wide flowing curves, gentle elevation
 */
function chooseSegment(sec: AudioSection, onsetDensity: number, rng: Rng, avgSpeed: number, eRel: number): SegmentPlan {
  const e = sec.energy
  const roll = rng()
  // T77/T78: special track parts — wide boost speedways, narrow rail-less
  // ridges where falling off is on the table
  const special = rng()
  // R9b/T154: full vertical loop in the song's OWN hottest stretches —
  // relative gate + low absolute floor (chill stays chill)
  if (eRel > 0.78 && e > 0.32 && onsetDensity > 0.9 && special >= 0.31 && special < 0.385) {
    const radius = 42 + avgSpeed * 0.045 // re-anchored: avgSpeed is 2.2× the old scale
    return {
      type: 'loop',
      length: Math.PI * 2 * radius,
      curvature: 0,
      slope: 0,
      radius,
      side: rng() < 0.5 ? -1 : 1,
    }
  }
  if (eRel > 0.6 && e > 0.25 && special < 0.09) {
    return {
      type: 'speedway',
      length: rngRange(rng, 340, 500),
      curvature: 0,
      slope: rngRange(rng, -0.01, 0.01),
      widthScale: 1.6,
      walls: true,
    }
  }
  if (eRel > 0.5 && e > 0.22 && onsetDensity > 0.6 && special >= 0.17 && special < 0.35) {
    // T92/T151/T154: ride the wall — sustained ~60° bank, LONG, sloped, and
    // common in any song's upper half. T165: ~30% go near-VERTICAL — short,
    // slim, a genuine coordination test on the wall face.
    const dir = rng() < 0.5 ? -1 : 1
    const vertical = rng() < 0.3
    return {
      type: 'wallride',
      length: vertical ? rngRange(rng, 240, 360) : rngRange(rng, 320, 560),
      curvature: (vertical ? rngRange(rng, 0.0022, 0.0034) : rngRange(rng, 0.0018, 0.003)) * dir,
      slope: vertical ? 0 : rngRange(rng, -0.04, 0.04),
      widthScale: vertical ? 0.9 : 1.15,
      walls: true,
      bankAbs: vertical ? 1.48 : 1.05,
    }
  }
  // T160: spiral — LONG descending hard-banked sweeper, a serpentine drop
  if (eRel > 0.55 && e > 0.28 && special >= 0.385 && special < 0.43) {
    return {
      type: 'curve',
      length: rngRange(rng, 600, 900),
      curvature: rngRange(rng, 0.0035, 0.0055) * (rng() < 0.5 ? -1 : 1),
      slope: rngRange(rng, -0.06, -0.035),
      bankGain: 420, // slams the 0.78 cap — riding the wall of the spiral
      widthScale: 1.3, // steep + tight needs shoulder room to be FUN
    }
  }
  // T160: sbank — sustained hard right-bank PULLING into hard left-bank
  if (eRel > 0.6 && e > 0.3 && onsetDensity > 1.2 && special >= 0.43 && special < 0.5) {
    return {
      type: 'chicane',
      length: rngRange(rng, 480, 720),
      curvature: rngRange(rng, 0.004, 0.0065) * (rng() < 0.5 ? -1 : 1), // T170
      slope: 0,
      bankGain: 400,
      widthScale: 1.3, // room to swing the S
    }
  }
  if (e > 0.3 && special >= 0.09 && special < 0.17) {
    return {
      type: 'ridge',
      length: rngRange(rng, 220, 340),
      curvature: rngRange(rng, 0.001, 0.0028) * (rng() < 0.5 ? -1 : 1),
      slope: rngRange(rng, -0.01, 0.02),
      widthScale: 0.6,
      walls: false,
    }
  }

  // T60/T154: barrel-roll the road in above-average sections — was locked
  // behind an absolute e>0.6 no real song ever reached
  if (eRel > 0.68 && e > 0.28 && onsetDensity > 0.8 && roll < 0.3) {
    // T160: both chiralities — the road barrels left OR right
    return { type: 'corkscrew', length: rngRange(rng, 420, 640), curvature: 0, slope: 0, side: rng() < 0.5 ? -1 : 1, walls: rng() >= 0.2 } // T164: sometimes bare
  }

  if (e > 0.6 || (eRel > 0.85 && e > 0.3)) {
    if (onsetDensity > 2.5 && roll < 0.52) {
      return {
        // each half of the S needs ≥2s at ridden pace; curvature softened —
        // quick left-rights are a rhythm change, not a wall lottery
        type: 'chicane',
        length: rngRange(rng, 320, 480),
        curvature: rngRange(rng, 0.0065, 0.011) * (rng() < 0.5 ? -1 : 1),
        slope: 0,
        bankGain: 170 + e * 240, // T151 (absolute: calm songs bank gently)
        widthScale: 1.4,
      }
    }
    if (roll < 0.75) {
      return { type: 'straight', length: rngRange(rng, 250, 450), curvature: 0, slope: rngRange(rng, -0.035, 0.035), widthScale: rngRange(rng, 1.1, 1.6), walls: rng() >= 0.3 } // T163/T164
    }
    {
      // T168 → breathing room: hot sweepers are LONG sustained arcs, and the
      // long ones run WIDE — inside/middle/outside are genuinely different
      // lines with meters between them, not a single survivable groove
      const len = rngRange(rng, 480, 820)
      return {
        type: 'curve',
        length: len,
        curvature: rngRange(rng, 0.006, 0.012) * (rng() < 0.5 ? -1 : 1),
        slope: 0,
        bankGain: 170 + e * 240, // T151
        widthScale: len > 600 ? rngRange(rng, 1.6, 2.2) : rngRange(rng, 1.25, 1.6),
        walls: rng() >= 0.15,
      }
    }
  }

  if (e > 0.3) {
    if (roll < 0.5) {
      {
        const len = rngRange(rng, 380, 700) // T168: long = wide
        return {
          type: 'curve',
          length: len,
          curvature: rngRange(rng, 0.004, 0.009) * (rng() < 0.5 ? -1 : 1),
          slope: rngRange(rng, -0.015, 0.015),
          bankGain: 170 + e * 240, // T151
          widthScale: len > 520 ? rngRange(rng, 1.5, 2.0) : rngRange(rng, 1.15, 1.5),
          walls: rng() >= 0.15,
        }
      }
    }
    if (roll < 0.75) {
      return { type: 'hill', length: rngRange(rng, 170, 300), curvature: 0, slope: rngRange(rng, 0.08, 0.21) * (rng() < 0.5 ? -1 : 1) } // T163
    }
    return { type: 'straight', length: rngRange(rng, 180, 320), curvature: 0, slope: 0, widthScale: rngRange(rng, 1.05, 1.5), walls: rng() >= 0.3 } // T164
  }

  return {
    type: 'curve',
    length: rngRange(rng, 380, 680),
    curvature: rngRange(rng, 0.002, 0.005) * (rng() < 0.5 ? -1 : 1),
    slope: rngRange(rng, -0.01, 0.01),
    bankGain: 170 + e * 240, // T151
    widthScale: rngRange(rng, 1.1, 1.5), // T164
    walls: rng() >= 0.12,
  }
}

function walkSegment(
  cur: Cursor,
  points: TrackPoint[],
  rolls: number[],
  ups: number[],
  seg: SegmentPlan,
  length: number,
): void {
  // R9b: vertical loop — analytic circle in the heading plane, inclined
  // sideways so the exit clears the entry road. Heading/pitch Euler walk
  // gimbals at ±90°, so the loop is walked parametrically instead.
  if (seg.type === 'loop' && seg.radius && seg.side) {
    const R = seg.radius
    const steps = Math.max(12, Math.round(length / Math.min(CTRL_SPACING, R * 0.3)))
    const fx = Math.sin(cur.heading)
    const fz = -Math.cos(cur.heading)
    // right-hand side vector r = f × worldUp (horizontal)
    const rx = -fz
    const rz = fx
    const W = (38 + R * 0.18) * seg.side // lateral exit shift, clears track width
    const x0 = cur.x
    const y0 = cur.y
    const z0 = cur.z
    for (let i = 1; i <= steps; i++) {
      const th = (i / steps) * Math.PI * 2
      const fwd = Math.sin(th) * R
      const lift = (1 - Math.cos(th)) * R
      const side = (i / steps) * W
      points.push({ x: x0 + fx * fwd + rx * side, y: y0 + lift, z: z0 + fz * fwd + rz * side })
      // track-up points at the loop center: up·cosθ − f·sinθ
      ups.push(-fx * Math.sin(th), Math.cos(th), -fz * Math.sin(th))
      rolls.push(cur.roll)
    }
    cur.x = x0 + rx * W
    cur.z = z0 + rz * W
    cur.y = y0
    cur.pitch = 0
    return
  }

  const steps = Math.max(1, Math.round(length / CTRL_SPACING))
  const ds = length / steps
  const isChicane = seg.type === 'chicane'
  const isJump = seg.type === 'jump'
  // T60: corkscrew = exactly one full 2π twist over the segment, ends upright
  const rollStep = seg.type === 'corkscrew' ? ((seg.side ?? 1) * Math.PI * 2) / steps : 0 // T160: chirality
  // T65: banked corners — roll into the curve like a velodrome
  const bankTarget =
    seg.type === 'wallride'
      ? Math.sign(seg.curvature) * (seg.bankAbs ?? 1.05) // T92/T165: 60° or the vertical face
      : seg.type === 'curve' || seg.type === 'chicane'
        ? Math.max(-0.78, Math.min(0.78, seg.curvature * (seg.bankGain ?? 200))) // B17/T151
        : 0

  for (let i = 0; i < steps; i++) {
    const t = i / steps
    // transition windows: curvature (and bank, below) ramp in over the first
    // 12% and out over the last 12% of the segment — entering a sweeper is a
    // swell, not a step discontinuity in drift; exits unwind before the seam
    const edgeWin = Math.min(1, t / 0.12, (1 - t) / 0.12)
    // chicane S-flip passes THROUGH flat — no instant sign snap mid-corner;
    // wide window (≈40% of the segment ramps) so the flip is a breath
    const flipWin = isChicane ? Math.min(1, Math.abs(t - 0.5) * 5) : 1
    let k = seg.curvature * edgeWin
    if (isChicane) {
      k = (i < steps / 2 ? seg.curvature : -seg.curvature) * edgeWin * flipWin
    }
    let slopeTarget = seg.slope
    let ease = 0.3
    if (isJump) {
      // seg.slope carries drop strength: ramp to a crest @ 28%, then a
      // catchable dive (T36 → T158: gentler crest, shallower dive)
      slopeTarget = t < 0.28 ? 0.04 + seg.slope * 0.018 : -0.06 * seg.slope - 0.03 // T170
      ease = 0.45
    }
    cur.heading += k * ds
    cur.pitch += (slopeTarget - cur.pitch) * ease
    cur.x += Math.sin(cur.heading) * ds
    cur.z -= Math.cos(cur.heading) * ds
    cur.y += cur.pitch * ds
    // runaway-dive guard — the GridFloor FOLLOWS the track (height −85, see
    // Environment.tsx), so this is generous: long descending courses keep
    // diving instead of flattening into a self-cut plane at the old −130
    if (cur.y < -400) {
      cur.y = -400
      cur.pitch = Math.max(0, cur.pitch)
    }
    if (rollStep !== 0) {
      cur.roll += rollStep
    } else {
      // ease toward bank (or back to upright), preserving full corkscrew turns
      const base = Math.round(cur.roll / (Math.PI * 2)) * Math.PI * 2
      // bank rides the same transition windows as curvature — rolls on with
      // the corner, unwinds before the seam, passes flat through the S-flip
      let bank = (isChicane && i >= steps / 2 ? -bankTarget : bankTarget) * edgeWin * flipWin
      // B32: this guard silently zeroed WALLRIDE banks since T92 — every
      // "wallride" shipped as a flat wide curve. Wallrides bank now.
      if (seg.type !== 'curve' && seg.type !== 'chicane' && seg.type !== 'wallride') bank = 0
      // wallrides climb onto the face fast — curves ease gently
      const bankEase = seg.type === 'wallride' ? 0.4 : 0.22
      cur.roll += (base + bank - cur.roll) * bankEase
    }
    points.push({ x: cur.x, y: cur.y, z: cur.z })
    rolls.push(cur.roll)
    ups.push(0, 1, 0)
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
