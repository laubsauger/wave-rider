/**
 * T181: recently played user songs — localStorage META records only (V26).
 * Audio bytes never persist; they live in the session library (store.userSongs)
 * or on the user's disk via the explicit SAVE SONG download.
 */

export interface RecentSong {
  id: string
  title: string
  bpm: number
  mood?: string
  intensity?: number
  durationLabel: string
  /** 0..1 peak bars for the menu card (96 bins ≈ 0.5KB) */
  waveform: number[]
  /** epoch ms of last play */
  playedAt: number
}

const KEY = 'wave-rider-recents'
const MAX = 8

export function loadRecents(): RecentSong[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as RecentSong[]
    if (!Array.isArray(arr)) return []
    return arr.filter((r) => r && typeof r.id === 'string' && typeof r.title === 'string')
  } catch {
    return []
  }
}

/** insert/refresh a record at the top — dedupe by id, cap at MAX */
export function recordRecent(meta: Omit<RecentSong, 'playedAt'>): RecentSong[] {
  const next = [
    { ...meta, playedAt: Date.now() },
    ...loadRecents().filter((r) => r.id !== meta.id),
  ].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode / quota — recents are best-effort */
  }
  return next
}

/**
 * container sniff from magic bytes — the joiner receives a typeless byte blob
 * over the wire; saving it as the wrong extension confuses players & players'
 * players (the OS). Defaults to mp3 (bundled catalog + most uploads).
 */
export function sniffAudioExt(bytes: ArrayBuffer): 'mp3' | 'wav' | 'ogg' | 'm4a' {
  const b = new Uint8Array(bytes.slice(0, 12))
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (ascii(4, 4) === 'ftyp') return 'm4a'
  // 'ID3' tag or raw mpeg frame sync 0xFFEx
  return 'mp3'
}

/** trigger a browser download of the song bytes (SAVE SONG, T181) */
export function saveSongToDevice(title: string, bytes: ArrayBuffer): void {
  const ext = sniffAudioExt(bytes)
  const blob = new Blob([bytes], { type: ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
