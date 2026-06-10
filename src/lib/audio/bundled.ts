/**
 * Bundled real songs (T15, C10): user-owned files in audio/.
 * Vite turns matches into hashed asset URLs; flow fetches + decodes like an
 * upload. Files are gitignored — drop tracks locally for dev. CI builds fine
 * with an empty list. Synth songs in builtin.ts remain as DEBUG entries.
 */
const modules = import.meta.glob<string>('../../../audio/*.{mp3,wav,ogg,m4a}', {
  eager: true,
  query: '?url',
  import: 'default',
})

function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? 'track'
  return base.replace(/\.[^.]+$/, '').toUpperCase()
}

function idFromPath(path: string): string {
  return titleFromPath(path)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export interface BundledSong {
  id: string
  title: string
  url: string
  /** rough display length, m:ss */
  lengthLabel: string
}

export const BUNDLED_SONGS: BundledSong[] = Object.entries(modules).map(([path, url]) => ({
  id: idFromPath(path),
  title: titleFromPath(path),
  url,
  lengthLabel: '—',
}))
