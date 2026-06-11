/**
 * Track geometry builder (T4): road ribbon, glowing edge rails, low walls.
 * Pure arrays in/out — three BufferGeometry assembled scene-side.
 */
import type { TrackData } from './generate'
import type { TrackFrames } from './sample'

export interface RibbonGeometry {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

/** Road surface: two verts per frame at ±halfWidth·widthScale (T77). */
export function buildRoad(track: TrackData, frames: TrackFrames): RibbonGeometry {
  return buildStrip(frames, -track.width / 2, track.width / 2, 0, 0, false)
}

/** Edge rail: thin bright strip just outside the road; collapses on rail-less ridges (T78). */
export function buildRail(track: TrackData, frames: TrackFrames, side: -1 | 1): RibbonGeometry {
  const inner = (track.width / 2) * side
  const outer = (track.width / 2 + 0.6) * side
  return buildStrip(frames, Math.min(inner, outer), Math.max(inner, outer), 0.25, 0.25, true)
}

/** Wall: vertical strip at the road edge; absent where walls=false (T78). */
export function buildWall(track: TrackData, frames: TrackFrames, side: -1 | 1): RibbonGeometry {
  const d = (track.width / 2 + 0.7) * side
  return buildStrip(frames, d, d, 0, 1.6, true)
}

function buildStrip(
  frames: TrackFrames,
  dLeft: number,
  dRight: number,
  hLeft: number,
  hRight: number,
  needsWalls: boolean,
): RibbonGeometry {
  const n = frames.count
  const positions = new Float32Array(n * 2 * 3)
  const normals = new Float32Array(n * 2 * 3)
  const uvs = new Float32Array(n * 2 * 2)
  const indices = new Uint32Array((n - 1) * 6)

  for (let i = 0; i < n; i++) {
    const ws = frames.widths[i]
    const collapsed = needsWalls && frames.walls[i] < 0.5
    const dl = dLeft * ws * (collapsed ? 0.0001 : 1)
    const dr = dRight * ws * (collapsed ? 0.0001 : 1)
    const hl = collapsed ? 0 : hLeft
    const hr = collapsed ? 0 : hRight
    const px = frames.positions[i * 3]
    const py = frames.positions[i * 3 + 1]
    const pz = frames.positions[i * 3 + 2]
    const bx = frames.binormals[i * 3]
    const by = frames.binormals[i * 3 + 1]
    const bz = frames.binormals[i * 3 + 2]
    const nx = frames.normals[i * 3]
    const ny = frames.normals[i * 3 + 1]
    const nz = frames.normals[i * 3 + 2]

    positions.set(
      [
        px + bx * dl + nx * hl,
        py + by * dl + ny * hl,
        pz + bz * dl + nz * hl,
        px + bx * dr + nx * hr,
        py + by * dr + ny * hr,
        pz + bz * dr + nz * hr,
      ],
      i * 6,
    )
    normals.set([nx, ny, nz, nx, ny, nz], i * 6)
    const v = (i * frames.ds) / 20
    uvs.set([0, v, 1, v], i * 4)
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
  }

  return { positions, normals, uvs, indices }
}

/** Split divider: raised island slab between the two lanes — verts ride the
 * per-sample median half-width, so it grows out of the deck at the fork and
 * sinks away at the merge. Collapsed (≈0) wherever medians are 0. */
export function buildMedian(frames: TrackFrames): RibbonGeometry {
  const n = frames.count
  const positions = new Float32Array(n * 2 * 3)
  const normals = new Float32Array(n * 2 * 3)
  const uvs = new Float32Array(n * 2 * 2)
  const indices = new Uint32Array((n - 1) * 6)
  for (let i = 0; i < n; i++) {
    const m = Math.max(0.0001, frames.medians[i] - 0.15)
    const h = Math.min(0.9, frames.medians[i] * 0.4)
    const px = frames.positions[i * 3]
    const py = frames.positions[i * 3 + 1]
    const pz = frames.positions[i * 3 + 2]
    const bx = frames.binormals[i * 3]
    const by = frames.binormals[i * 3 + 1]
    const bz = frames.binormals[i * 3 + 2]
    const nx = frames.normals[i * 3]
    const ny = frames.normals[i * 3 + 1]
    const nz = frames.normals[i * 3 + 2]
    positions.set(
      [
        px - bx * m + nx * h,
        py - by * m + ny * h,
        pz - bz * m + nz * h,
        px + bx * m + nx * h,
        py + by * m + ny * h,
        pz + bz * m + nz * h,
      ],
      i * 6,
    )
    normals.set([nx, ny, nz, nx, ny, nz], i * 6)
    const v = (i * frames.ds) / 20
    uvs.set([0, v, 1, v], i * 4)
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
  }
  return { positions, normals, uvs, indices }
}

export interface BoostPadInstance {
  /** world position */
  x: number
  y: number
  z: number
  /** orientation basis */
  tx: number
  ty: number
  tz: number
  nx: number
  ny: number
  nz: number
}

export function buildBoostPads(track: TrackData, frames: TrackFrames): BoostPadInstance[] {
  return track.boosts.map((b) => {
    const i = Math.min(frames.count - 1, Math.max(0, Math.round(b.s / frames.ds)))
    const d = b.lane * (track.width / 2 - 1.5)
    return {
      x: frames.positions[i * 3] + frames.binormals[i * 3] * d + frames.normals[i * 3] * 0.05,
      y: frames.positions[i * 3 + 1] + frames.binormals[i * 3 + 1] * d + frames.normals[i * 3 + 1] * 0.05,
      z: frames.positions[i * 3 + 2] + frames.binormals[i * 3 + 2] * d + frames.normals[i * 3 + 2] * 0.05,
      tx: frames.tangents[i * 3],
      ty: frames.tangents[i * 3 + 1],
      tz: frames.tangents[i * 3 + 2],
      nx: frames.normals[i * 3],
      ny: frames.normals[i * 3 + 1],
      nz: frames.normals[i * 3 + 2],
    }
  })
}
