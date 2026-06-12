/**
 * Ghost recording and serialization.
 * Records ShipState (s, d, v, yaw) periodically.
 */
import type { ShipState } from '../physics/ship'

export const GHOST_HZ = 10
export const GHOST_DT = 1 / GHOST_HZ

export interface GhostData {
  songTitle?: string
  timeMs?: number
  songId: string
  frames: Float32Array // [s, d, v, yaw,  s, d, v, yaw, ...]
}

export function createGhostRecorder(songId: string) {
  const frames: number[] = []
  let lastRecordTime = -1

  return {
    record(state: ShipState) {
      if (state.time >= lastRecordTime + GHOST_DT) {
        frames.push(state.s, state.d, state.v, state.yaw)
        lastRecordTime = state.time
      }
    },
    finish(): GhostData {
      return {
        songId,
        frames: new Float32Array(frames)
      }
    }
  }
}

export async function serializeGhost(data: GhostData): Promise<string> {
  // T183: meta line is JSON — carries time + title so the ghost lobby can
  // show them. deserializeGhost still reads the old plain-id meta line.
  const meta = JSON.stringify({ songId: data.songId, timeMs: data.timeMs, songTitle: data.songTitle })
  const metaBytes = new TextEncoder().encode(meta + '\n')
  const blob = new Blob([metaBytes, data.frames.buffer as ArrayBuffer])
  
  const ds = new CompressionStream('gzip')
  const compressedStream = blob.stream().pipeThrough(ds)
  const compressedBytes = await new Response(compressedStream).arrayBuffer()
  
  let binary = ''
  const bytes = new Uint8Array(compressedBytes)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  
  // Replace + and / to make it URL safe
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function deserializeGhost(base64Safe: string): Promise<GhostData> {
  // Restore base64 chars
  let base64 = base64Safe.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  
  const blob = new Blob([bytes])
  const ds = new DecompressionStream('gzip')
  const decompressedStream = blob.stream().pipeThrough(ds)
  const decompressedBytes = await new Response(decompressedStream).arrayBuffer()
  
  const arr = new Uint8Array(decompressedBytes)
  const nlIndex = arr.indexOf(10) // '\n'
  if (nlIndex === -1) throw new Error('Invalid ghost data')
  
  const metaLine = new TextDecoder().decode(arr.slice(0, nlIndex))
  const floatBytes = arr.slice(nlIndex + 1)

  // To avoid alignment issues, copy to a properly aligned buffer if necessary,
  // or simply create a new Float32Array by passing the byteOffset correctly.
  // slice() on Uint8Array creates a new ArrayBuffer, so byteOffset is 0, which is aligned.
  const frames = new Float32Array(floatBytes.buffer, floatBytes.byteOffset, floatBytes.byteLength / 4)

  // new links: JSON meta {songId,timeMs,songTitle}; old links: bare id string
  if (metaLine.startsWith('{')) {
    try {
      const meta = JSON.parse(metaLine) as Partial<GhostData>
      if (typeof meta.songId === 'string') {
        return { songId: meta.songId, timeMs: meta.timeMs, songTitle: meta.songTitle, frames }
      }
    } catch {
      /* fall through to legacy read */
    }
  }
  return { songId: metaLine, frames }
}
