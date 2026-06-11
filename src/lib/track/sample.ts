/**
 * Spline sampling shared by rendering (T4) and physics (T5, C9): both read
 * the same centerline frames so the visual road and the sim never disagree.
 */
import { CatmullRomCurve3, Vector3 } from 'three'
import type { TrackData } from './generate'

export interface TrackFrames {
  /** spacing between samples, meters */
  ds: number
  count: number
  /** xyz triplets */
  positions: Float32Array
  tangents: Float32Array
  /** track-up per sample */
  normals: Float32Array
  /** lateral axis per sample (right-hand) */
  binormals: Float32Array
  /** total arc length */
  length: number
  /** T77: per-sample width multiplier (smoothed) */
  widths: Float32Array
  /** T78: per-sample wall presence 1|0 */
  walls: Float32Array
  /** split segments: central divider half-width in meters (smoothed; 0 = none) */
  medians: Float32Array
}

export function sampleTrack(track: TrackData, ds = 3): TrackFrames {
  const pts = track.points.map((p) => new Vector3(p.x, p.y, p.z))
  const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5)
  // R9b: default arcLengthDivisions (200) gives ~145m arc resolution on a
  // 30km track — getPointAt and the ctrl-attribute mapping below MUST share
  // one high-res parameterization or ups/rolls land ~100m off their geometry.
  curve.arcLengthDivisions = Math.max(200, pts.length * 4)
  const length = curve.getLength()
  const count = Math.max(2, Math.ceil(length / ds) + 1)

  const positions = new Float32Array(count * 3)
  const widths = new Float32Array(count)
  const walls = new Float32Array(count)
  const medians = new Float32Array(count)
  const tangents = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const binormals = new Float32Array(count * 3)

  const p = new Vector3()
  const t = new Vector3()
  const n = new Vector3()
  const b = new Vector3()

  const rolls = track.rolls
  const ups = track.ups
  // R9b: control points are NOT arc-uniform (loop spacing ≠ CTRL_SPACING,
  // chords ≠ walk distance), so per-point attributes (ups, rolls) must be
  // looked up by true arc position. CatmullRomCurve3.getPoint(j/(N-1)) hits
  // control point j exactly — integrate arc length at uniform t to map it.
  const nPts = pts.length
  const tLengths = curve.getLengths(curve.arcLengthDivisions)
  const ctrlS = new Float32Array(nPts)
  for (let j = 0; j < nPts; j++) {
    const f = (j / (nPts - 1)) * (tLengths.length - 1)
    const j0 = Math.floor(f)
    const j1 = Math.min(tLengths.length - 1, j0 + 1)
    ctrlS[j] = tLengths[j0] + (tLengths[j1] - tLengths[j0]) * (f - j0)
  }

  let cj = 0
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1)
    curve.getPointAt(u, p)
    curve.getTangentAt(u, t)
    const sArc = u * length
    while (cj < nPts - 2 && ctrlS[cj + 1] <= sArc) cj++
    const span = Math.max(1e-6, ctrlS[cj + 1] - ctrlS[cj])
    const ua = Math.min(1, Math.max(0, (sArc - ctrlS[cj]) / span))
    // R9b: track-up comes from the generator's per-control-point ups —
    // (0,1,0) everywhere except loops, where the analytic circle normal
    // carries the frame through inversion. Project the tangent out of it.
    n.set(
      ups[cj * 3] * (1 - ua) + ups[(cj + 1) * 3] * ua,
      ups[cj * 3 + 1] * (1 - ua) + ups[(cj + 1) * 3 + 1] * ua,
      ups[cj * 3 + 2] * (1 - ua) + ups[(cj + 1) * 3 + 2] * ua,
    )
    n.addScaledVector(t, -n.dot(t)).normalize()
    b.crossVectors(t, n).normalize()
    // T60: corkscrew — twist the frame around the tangent by the walked roll
    const roll = rolls[cj] + (rolls[Math.min(rolls.length - 1, cj + 1)] - rolls[cj]) * ua
    if (roll !== 0) {
      n.applyAxisAngle(t, roll)
      b.crossVectors(t, n).normalize()
    }

    positions.set([p.x, p.y, p.z], i * 3)
    tangents.set([t.x, t.y, t.z], i * 3)
    normals.set([n.x, n.y, n.z], i * 3)
    binormals.set([b.x, b.y, b.z], i * 3)
  }

  // T77/T78: width + wall flags per sample, eased so transitions taper
  const dsOut = length / (count - 1)
  let segIdx = 0
  for (let i = 0; i < count; i++) {
    const sArc = i * dsOut
    while (segIdx < track.segments.length - 1 && sArc >= track.segments[segIdx].end) segIdx++
    widths[i] = track.segments[segIdx]?.widthScale ?? 1
    walls[i] = (track.segments[segIdx]?.walls ?? true) ? 1 : 0
    // split: a divider island down the middle — eased below, so it grows out
    // of the deck at the fork and sinks back at the merge
    medians[i] = track.segments[segIdx]?.type === 'split' ? 2.6 : 0
  }
  for (let i = 1; i < count; i++) widths[i] = widths[i - 1] + (widths[i] - widths[i - 1]) * 0.12
  for (let i = count - 2; i >= 0; i--) widths[i] = widths[i + 1] + (widths[i] - widths[i + 1]) * 0.12
  for (let i = 1; i < count; i++) medians[i] = medians[i - 1] + (medians[i] - medians[i - 1]) * 0.12
  for (let i = count - 2; i >= 0; i--) medians[i] = medians[i + 1] + (medians[i] - medians[i + 1]) * 0.12

  return { ds: dsOut, count, positions, tangents, normals, binormals, length, widths, walls, medians }
}

/** Signed horizontal curvature (rad/m) at sample i — steers physics drift + camera lean. */
export function curvatureAt(frames: TrackFrames, i: number): number {
  const j = Math.min(frames.count - 1, Math.max(0, i))
  const k = Math.min(frames.count - 1, j + 1)
  if (j === k) return 0
  const ax = frames.tangents[j * 3]
  const az = frames.tangents[j * 3 + 2]
  const bx = frames.tangents[k * 3]
  const bz = frames.tangents[k * 3 + 2]
  const angA = Math.atan2(ax, -az)
  const angB = Math.atan2(bx, -bz)
  let d = angB - angA
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  // R9b: horizontal heading is meaningless where the tangent goes vertical
  // (inside loops it flips by π at the apex) — weight by the horizontal
  // tangent magnitude so loop traversal doesn't read as an instant hairpin.
  const w = Math.min(Math.hypot(ax, az), Math.hypot(bx, bz))
  return (d / frames.ds) * Math.min(1, w)
}

export interface FramePose {
  px: number
  py: number
  pz: number
  tx: number
  ty: number
  tz: number
  nx: number
  ny: number
  nz: number
  bx: number
  by: number
  bz: number
}

/** Interpolated pose at arc length s, lateral offset d, height h above road.
 * Negative s extrapolates straight back along the start tangent — the launch
 * grid lives at s<0; clamping used to render every grid ship stacked AT the
 * line (they share s=0 visually until launch). */
export function poseAt(frames: TrackFrames, s: number, d: number, h: number, out: FramePose): FramePose {
  if (s < 0) {
    out.tx = frames.tangents[0]
    out.ty = frames.tangents[1]
    out.tz = frames.tangents[2]
    out.nx = frames.normals[0]
    out.ny = frames.normals[1]
    out.nz = frames.normals[2]
    out.bx = frames.binormals[0]
    out.by = frames.binormals[1]
    out.bz = frames.binormals[2]
    out.px = frames.positions[0] + out.tx * s + out.bx * d + out.nx * h
    out.py = frames.positions[1] + out.ty * s + out.by * d + out.ny * h
    out.pz = frames.positions[2] + out.tz * s + out.bz * d + out.nz * h
    return out
  }
  const f = Math.min(frames.count - 1.001, Math.max(0, s / frames.ds))
  const i0 = Math.floor(f)
  const i1 = i0 + 1
  const a = f - i0

  const lerp = (arr: Float32Array, c: number) => arr[i0 * 3 + c] * (1 - a) + arr[i1 * 3 + c] * a

  out.tx = lerp(frames.tangents, 0)
  out.ty = lerp(frames.tangents, 1)
  out.tz = lerp(frames.tangents, 2)
  out.nx = lerp(frames.normals, 0)
  out.ny = lerp(frames.normals, 1)
  out.nz = lerp(frames.normals, 2)
  out.bx = lerp(frames.binormals, 0)
  out.by = lerp(frames.binormals, 1)
  out.bz = lerp(frames.binormals, 2)
  out.px = lerp(frames.positions, 0) + out.bx * d + out.nx * h
  out.py = lerp(frames.positions, 1) + out.by * d + out.ny * h
  out.pz = lerp(frames.positions, 2) + out.bz * d + out.nz * h
  return out
}
