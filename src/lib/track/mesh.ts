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

/** Road surface: two verts per frame at ±halfWidth. */
export function buildRoad(track: TrackData, frames: TrackFrames): RibbonGeometry {
  return buildStrip(frames, -track.width / 2, track.width / 2, 0, 0)
}

/** Edge rail: thin bright strip just outside the road, slightly raised. */
export function buildRail(track: TrackData, frames: TrackFrames, side: -1 | 1): RibbonGeometry {
  const inner = (track.width / 2) * side
  const outer = (track.width / 2 + 0.6) * side
  return buildStrip(frames, Math.min(inner, outer), Math.max(inner, outer), 0.25, 0.25)
}

/** Wall: vertical strip at the road edge. */
export function buildWall(track: TrackData, frames: TrackFrames, side: -1 | 1): RibbonGeometry {
  const d = (track.width / 2 + 0.7) * side
  return buildStrip(frames, d, d, 0, 1.6)
}

function buildStrip(
  frames: TrackFrames,
  dLeft: number,
  dRight: number,
  hLeft: number,
  hRight: number,
): RibbonGeometry {
  const n = frames.count
  const positions = new Float32Array(n * 2 * 3)
  const normals = new Float32Array(n * 2 * 3)
  const uvs = new Float32Array(n * 2 * 2)
  const indices = new Uint32Array((n - 1) * 6)

  for (let i = 0; i < n; i++) {
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
        px + bx * dLeft + nx * hLeft,
        py + by * dLeft + ny * hLeft,
        pz + bz * dLeft + nz * hLeft,
        px + bx * dRight + nx * hRight,
        py + by * dRight + ny * hRight,
        pz + bz * dRight + nz * hRight,
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
