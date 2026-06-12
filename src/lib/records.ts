/**
 * T183/V28: per-track records — local leaderboard (top-5 finished times) and
 * the best run's ghost, persisted in localStorage. Keyed `songId:seed` so two
 * different files sharing a name never pollute each other's board (V1 makes
 * the seed stable per audio). Ghost frames stored gzip+base64 (V26: compact
 * records OK, audio bytes never).
 */

export interface RunEntry {
  timeMs: number
  topSpeed: number
  place: number
  date: number
}

export interface TrackRecord {
  key: string
  title: string
  /** finished runs only, sorted asc, max TIMES_MAX */
  times: RunEntry[]
  /** serialized ghost (lib/network/ghost) of the fastest finished run */
  bestGhost?: string
  bestTimeMs?: number
  updatedAt: number
}

const KEY = 'wave-rider-records'
const TIMES_MAX = 5
/** ghosts run ~30-60KB serialized — LRU cap keeps total well under quota */
const RECORDS_MAX = 20

export function recordKey(songId: string, seed: number): string {
  return `${songId}:${seed}`
}

function loadAll(): Record<string, TrackRecord> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as Record<string, TrackRecord>
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function saveAll(all: Record<string, TrackRecord>): void {
  // V28: LRU eviction — oldest records (with their ghosts) drop first.
  // Same-ms updatedAt ties break toward the later-inserted entry.
  const entries = Object.entries(all).map(([k, v], i) => ({ k, v, i }))
  if (entries.length > RECORDS_MAX) {
    entries.sort((a, b) => b.v.updatedAt - a.v.updatedAt || b.i - a.i)
    all = Object.fromEntries(entries.slice(0, RECORDS_MAX).map((e) => [e.k, e.v]))
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* quota / private mode — records are best-effort */
  }
}

export function loadRecord(songId: string, seed: number): TrackRecord | null {
  return loadAll()[recordKey(songId, seed)] ?? null
}

export interface SaveRunResult {
  /** 1-based position on the board, 0 = didn't make top-5 */
  rank: number
  newBest: boolean
}

/** insert a FINISHED run (caller gates on actual finish, V28) */
export function saveRun(songId: string, seed: number, title: string, run: RunEntry): SaveRunResult {
  const all = loadAll()
  const k = recordKey(songId, seed)
  const rec: TrackRecord = all[k] ?? { key: k, title, times: [], updatedAt: 0 }
  rec.title = title
  rec.times = [...rec.times, run].sort((a, b) => a.timeMs - b.timeMs).slice(0, TIMES_MAX)
  const newBest = rec.times[0] === run
  if (newBest) rec.bestTimeMs = run.timeMs
  rec.updatedAt = Date.now()
  all[k] = rec
  saveAll(all)
  const rank = rec.times.indexOf(run) + 1
  return { rank, newBest }
}

/** attach the serialized ghost of a run — V28: only kept if it IS the best */
export function saveBestGhost(songId: string, seed: number, timeMs: number, serialized: string): void {
  const all = loadAll()
  const rec = all[recordKey(songId, seed)]
  if (!rec || rec.bestTimeMs !== timeMs) return
  rec.bestGhost = serialized
  rec.updatedAt = Date.now()
  saveAll(all)
}
