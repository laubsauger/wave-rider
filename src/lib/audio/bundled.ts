/**
 * Bundled real songs (T15, C10): user-owned files imported from audio/.
 * Vite turns these into hashed asset URLs; flow fetches + decodes like an
 * upload. Synth songs in builtin.ts remain as DEBUG entries.
 */
import factoryLamentUrl from '../../../audio/Factory Lament.mp3?url'

export interface BundledSong {
  id: string
  title: string
  url: string
  /** rough display length, m:ss */
  lengthLabel: string
}

export const BUNDLED_SONGS: BundledSong[] = [
  {
    id: 'factory-lament',
    title: 'FACTORY LAMENT',
    url: factoryLamentUrl,
    lengthLabel: '7:59',
  },
]
