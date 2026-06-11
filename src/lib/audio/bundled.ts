/**
 * Bundled real songs (T15, C10): user-owned files committed under audio/.
 * Vite emits hashed asset URLs; flow fetches + decodes like an upload.
 * Synth songs in builtin.ts remain as DEBUG entries.
 */
import inTaGetABagUrl from '../../../audio/M.O.E. - In ta get a bag.mp3?url'
import factoryUrl from '../../../audio/M.S.O. - Factory.mp3?url'
import nitsUrl from '../../../audio/M.S.O. - Nits.mp3?url'
import attentionUrl from '../../../audio/M.O.E. - Attention - old.mp3?url'

// T93: pregen sidecars (scripts/gen-meta.ts) — rich cards, zero mp3 bytes
export interface PregenMeta {
  waveform: number[]
  durationLabel: string
  bpm: number
  mood: string
  intensity: number
}
const pregen = import.meta.glob<PregenMeta>('../../../audio/*.meta.json', {
  eager: true,
  import: 'default',
})
function metaFor(mp3Url: string): PregenMeta | undefined {
  // prod URLs carry a hash suffix (Nits-D3Fa2.mp3) — match the sidecar's
  // base name as a substring of the decoded URL instead
  const u = decodeURIComponent(mp3Url)
  for (const [path, m] of Object.entries(pregen)) {
    const name = (path.split('/').pop() ?? '').replace(/\.meta\.json$/, '')
    if (name && u.includes(name)) return m
  }
  return undefined
}

export interface BundledSong {
  meta?: PregenMeta
  id: string
  title: string
  artist?: string
  url: string
  /** rough display length, m:ss */
  lengthLabel: string
}

const RAW_SONGS: BundledSong[] = [
  {
    id: 'mso-nits',
    title: 'NITS',
    artist: 'M.S.O.',
    url: nitsUrl,
    lengthLabel: '—',
  },
  {
    id: 'moe-in-ta-get-a-bag',
    title: 'IN TA GET A BAG',
    artist: 'M.O.E.',
    url: inTaGetABagUrl,
    lengthLabel: '—',
  },
  {
    id: 'mso-factory',
    title: 'FACTORY',
    artist: 'M.S.O.',
    url: factoryUrl,
    lengthLabel: '—',
  },
  {
    id: 'moe-attention',
    title: 'ATTENTION',
    artist: 'M.O.E.',
    url: attentionUrl,
    lengthLabel: '—',
  }
]

export const BUNDLED_SONGS: BundledSong[] = RAW_SONGS.map((s) => ({ ...s, meta: metaFor(s.url) }))

/** the ONE place "ARTIST — TITLE" is composed (T100). Display only — never a
 * lookup key (V27/B38); ghost-link compat matches against it explicitly. */
export function bundledDisplayTitle(s: BundledSong): string {
  return s.artist ? `${s.artist} — ${s.title}` : s.title
}

export interface BundledMeta {
  waveform: number[]
  durationLabel: string
}

const metaCache = new Map<string, Promise<BundledMeta>>()

/** lazy decode for menu waveform + duration (T34); cached per url */
export function getBundledMeta(url: string): Promise<BundledMeta> {
  let p = metaCache.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then(async (bytes) => {
        const { decodeForAnalysis, ANALYSIS_SR } = await import('./decode')
        const { computeWaveform, fmtDuration } = await import('./waveform')
        const pcm = await decodeForAnalysis(bytes)
        return { waveform: computeWaveform(pcm), durationLabel: fmtDuration(pcm.length / ANALYSIS_SR) }
      })
    metaCache.set(url, p)
  }
  return p
}
