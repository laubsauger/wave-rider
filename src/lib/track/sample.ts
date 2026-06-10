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
}

const UP = new Vector3(0, 1, 0)

export function sampleTrack(track: TrackData, ds = 3): TrackFrames {
  const pts = track.points.map((p) => new Vector3(p.x, p.y, p.z))
  const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5)
  const length = curve.getLength()
  const count = Math.max(2, Math.ceil(length / ds) + 1)

  const positions = new Float32Array(count * 3)
  const tangents = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const binormals = new Float32Array(count * 3)

  const p = new Vector3()
  const t = new Vector3()
  const n = new Vector3()
  const b = new Vector3()

  for (let i = 0; i < count; i++) {
    const u = i / (count - 1)
    curve.getPointAt(u, p)
    curve.getTangentAt(u, t)
    // project world-up out of tangent → track-up; banking applied visually later
    n.copy(UP).addScaledVector(t, -UP.dot(t)).normalize()
    b.crossVectors(t, n).normalize()

    positions.set([p.x, p.y, p.z], i * 3)
    tangents.set([t.x, t.y, t.z], i * 3)
    normals.set([n.x, n.y, n.z], i * 3)
    binormals.set([b.x, b.y, b.z], i * 3)
  }

  return { ds: length / (count - 1), count, positions, tangents, normals, binormals, length }
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
  return d / frames.ds
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

/** Interpolated pose at arc length s, lateral offset d, height h above road. */
export function poseAt(frames: TrackFrames, s: number, d: number, h: number, out: FramePose): FramePose {
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
