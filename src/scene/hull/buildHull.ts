import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { mulberry32, rngRange } from '../../lib/prng'

/**
 * R9a/T104 (v2 after feedback): STRUCTURED hull detail — flush panel seams,
 * spine plates, twin tail fins, wing-root intake scoops, livery stripes.
 * No random greeble scatter (read as warts). Everything merged into two
 * geometries (dark detail + emissive accent) so a fully dressed ship costs
 * 2 extra draw calls. Seeded per variant (no Math.random) so every dart
 * looks like every other dart.
 */

/** conservative solid half-span of the v5 planform at length z (nose -2.7 → tail 1.42) */
function spanAt(z: number, w: number): number {
  if (z < -2.6 || z > 1.38) return 0
  if (z < -1.1) return 0.34 * w * ((z + 2.7) / 1.6)
  if (z < 0.55) return (0.34 + (1.28 - 0.34) * ((z + 1.1) / 1.65)) * w * 0.92
  if (z < 0.85) return (0.88 - (0.88 - 0.42) * ((z - 0.55) / 0.3)) * w * 0.92
  return 0.36 * w
}

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
  rz = 0,
): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  if (ry !== 0) g.rotateY(ry)
  if (rz !== 0) g.rotateZ(rz)
  g.translate(x, y, z)
  return g
}

export interface HullDetail {
  detail: THREE.BufferGeometry
  accent: THREE.BufferGeometry
}

export function buildHullDetail(variant: 0 | 1 | 2): HullDetail {
  const rng = mulberry32((0x481177 ^ (variant * 0x9e3779)) >>> 0)
  const w = variant === 1 ? 0.85 : variant === 2 ? 1.18 : 1
  const detail: THREE.BufferGeometry[] = []
  const accent: THREE.BufferGeometry[] = []
  const topY = 0.4

  // panel lines: thin lateral grooves following the planform span
  for (let z = -2.2; z < 1.3; z += rngRange(rng, 0.34, 0.58)) {
    const half = spanAt(z, w)
    if (half < 0.12) continue
    detail.push(box(half * 2 * 0.9, 0.014, 0.022, 0, topY - 0.03, z))
  }
  // longitudinal seams flanking the spine
  for (const side of [-1, 1]) {
    detail.push(box(0.018, 0.014, 2.5, side * 0.24 * w, topY - 0.03, -0.35))
  }

  // armor plates marching down the spine — flush, centered, structured
  let z = -1.35
  while (z < 0.6) {
    const len = rngRange(rng, 0.32, 0.5)
    const pw = rngRange(rng, 0.22, 0.32) * w
    detail.push(box(pw, 0.035, len, 0, topY - 0.01, z + len / 2))
    z += len + rngRange(rng, 0.08, 0.16)
  }

  // twin tail fins — angled blades flanking the engine pod (silhouette!)
  for (const side of [-1, 1]) {
    detail.push(box(0.045, 0.52, 0.72, side * 0.3 * w, topY + 0.16, 1.0, 0, side * -0.22))
  }

  // wing-root intake scoops — chunky, swept with the leading edge
  for (const side of [-1, 1]) {
    detail.push(box(0.24 * w, 0.09, 0.46, side * 0.46 * w, topY - 0.01, 0.12, side * -0.3))
  }

  // sensor antenna behind the canopy
  detail.push(box(0.02, rngRange(rng, 0.22, 0.34), 0.02, 0.08, topY + 0.12, -0.45))

  // intake vents at the wing roots (accent-lit)
  for (const side of [-1, 1]) {
    accent.push(box(0.3 * w, 0.022, 0.05, side * 0.5 * w, topY - 0.02, 0.45, side * -0.35))
  }
  // livery: angled wing slashes, count varies per variant
  const stripes = 2 + (variant % 2)
  for (let si = 0; si < stripes; si++) {
    for (const side of [-1, 1]) {
      const sz = 0.28 + si * rngRange(rng, 0.2, 0.28)
      accent.push(
        box(0.46 * w, 0.016, 0.06, side * (0.55 + si * 0.12) * w, topY - 0.025, sz, side * -0.5),
      )
    }
  }

  return { detail: mergeGeometries(detail), accent: mergeGeometries(accent) }
}
