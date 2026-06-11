/**
 * T182/V27: resolve the host's current song to a transferable source by
 * STABLE ID. Display titles are never lookup keys — "ARTIST — TITLE"
 * composition silently broke title matching once already (B38).
 */
import { BUNDLED_SONGS, type BundledSong } from '../audio/bundled'
import { BUILTIN_SONGS, type SongSpec } from '../audio/builtin'
import type { UserSong } from '../../game/store'

export type SongSource =
  | { kind: 'bundled'; song: BundledSong }
  | { kind: 'synth'; spec: SongSpec }
  | { kind: 'custom'; song: UserSong }

export function resolveSongSource(songId: string | null, userSongs: UserSong[]): SongSource | null {
  if (!songId) return null
  const bundled = BUNDLED_SONGS.find((s) => s.id === songId)
  if (bundled) return { kind: 'bundled', song: bundled }
  const synth = BUILTIN_SONGS.find((s) => s.id === songId)
  if (synth) return { kind: 'synth', spec: synth }
  const user = userSongs.find((s) => s.id === songId)
  if (user) return { kind: 'custom', song: user }
  return null
}
