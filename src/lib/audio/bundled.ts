/**
 * Bundled real songs (T15, C10): user-owned files committed under audio/.
 * Vite emits hashed asset URLs; flow fetches + decodes like an upload.
 * Synth songs in builtin.ts remain as DEBUG entries.
 */
import inTaGetABagUrl from '../../../audio/M.O.E. - In ta get a bag.mp3?url'
import factoryUrl from '../../../audio/M.S.O. - Factory.mp3?url'
import nitsUrl from '../../../audio/M.S.O. - Nits.mp3?url'
import attentionUrl from '../../../audio/M.O.E. - Attention - old.mp3?url'

export interface BundledSong {
  id: string
  title: string
  artist?: string
  url: string
  /** rough display length, m:ss */
  lengthLabel: string
}

export const BUNDLED_SONGS: BundledSong[] = [
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
