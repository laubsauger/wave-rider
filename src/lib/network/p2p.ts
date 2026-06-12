import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'

export type P2PState = 'disconnected' | 'hosting' | 'joining' | 'connected'

export interface OpponentState {
  s: number
  d: number
  v: number
  yaw: number
  finished: boolean
}

export type NetworkMessage =
  | { type: 'lobby_song_builtin', songId: string }
  /** T182: synth debug track — joiner re-renders it locally (deterministic, V1) */
  | { type: 'lobby_song_synth', songId: string }
  | { type: 'lobby_song_custom', title: string, bytes: ArrayBuffer }
  | { type: 'lobby_ready' }
  /** V30: RTT probe — answered inside NetworkManager, never surfaced */
  | { type: 'ping', t: number }
  | { type: 'pong', t: number }
  /** startTime = ms until launch, already compensated by rtt/2 (V30) */
  | { type: 'race_start', startTime: number }
  | { type: 'state_update', state: OpponentState }
  | { type: 'race_finish', timeMs: number }
  | { type: 'status', text: string }

export class NetworkManager {
  peer: Peer | null = null
  conn: DataConnection | null = null
  state: P2PState = 'disconnected'
  isHost = false
  peerId: string | null = null
  
  onStateChange: (state: P2PState) => void = () => {}
  onMessage: (msg: NetworkMessage) => void = () => {}
  /** T87: human-readable connection failures for the lobby UI */
  onError: (msg: string) => void = () => {}
  /** V30: smallest measured roundtrip, ms — Infinity until the first pong */
  rtt = Infinity

  async host(): Promise<string> {
    this.isHost = true
    this.updateState('hosting')
    return new Promise((resolve, reject) => {
      this.peer = new Peer()
      this.armReconnect(this.peer)
      this.peer.on('open', (id) => {
        this.peerId = id
        resolve(id)
      })
      this.peer.on('connection', (c) => {
        this.conn = c
        this.setupConn()
      })
      this.peer.on('error', reject)
    })
  }

  join(hostId: string) {
    this.isHost = false
    this.updateState('joining')
    this.peer = new Peer()
    this.armReconnect(this.peer)
    // V30/B40: the host may be app-switched RIGHT NOW (sharing this very
    // link). Two failure shapes while it's away:
    //  - broker already dropped it → peer-unavailable error → retry below
    //  - broker still thinks it's online → our offer is relayed into the
    //    dead socket and LOST, no error ever fires → per-attempt timeout
    //    re-dials. ~45s total before declaring the link dead.
    let attempts = 0
    const MAX_ATTEMPTS = 8
    let timer: ReturnType<typeof setTimeout> | null = null
    const giveUp = (friendly: string) => {
      if (timer) clearTimeout(timer)
      this.onError(friendly)
      this.disconnect()
    }
    const tryConnect = () => {
      if (!this.peer || this.peer.destroyed || this.state !== 'joining') return
      this.conn?.close()
      this.conn = this.peer.connect(hostId, { reliable: true })
      this.setupConn()
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (this.state !== 'joining') return
        if (attempts < MAX_ATTEMPTS) {
          attempts++
          this.onError(`HOST NOT REACHABLE — maybe app-switched. Retrying (${attempts}/${MAX_ATTEMPTS})…`)
          tryConnect()
        } else {
          giveUp('HOST NOT FOUND — the link looks dead. Ask the host for a fresh one.')
        }
      }, 6000)
    }
    this.peer.on('open', tryConnect)
    this.peer.on('error', (err) => {
      console.error('Peer error', err)
      const type = (err as { type?: string }).type
      if (type === 'peer-unavailable' && attempts < MAX_ATTEMPTS && this.state === 'joining') {
        attempts++
        this.onError(`HOST NOT REACHABLE — maybe app-switched. Retrying (${attempts}/${MAX_ATTEMPTS})…`)
        if (timer) clearTimeout(timer)
        timer = setTimeout(tryConnect, 4000)
        return
      }
      giveUp(
        type === 'peer-unavailable'
          ? 'HOST NOT FOUND — the link is stale (host ids change on every page load). Ask the host for a fresh link.'
          : `Connection failed: ${String((err as Error).message ?? err)}`,
      )
    })
  }

  /** B40: app-switch on mobile (e.g. sharing the join link via a messenger)
   * suspends the tab — the signaling socket dies and the broker drops our id,
   * so the link a host JUST shared is stale before the friend taps it.
   * 'disconnected' fires on signaling loss with the peer still reusable:
   * reconnect() re-registers the SAME id. The visibility listener catches the
   * return-to-foreground case where the reconnect attempt itself died while
   * the tab was frozen. Established data channels are unaffected throughout. */
  private armReconnect(peer: Peer) {
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect()
    })
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        if (peer.destroyed) {
          document.removeEventListener('visibilitychange', onVisible)
          return
        }
        if (document.visibilityState === 'visible' && peer.disconnected) {
          peer.reconnect()
        }
      }
      document.addEventListener('visibilitychange', onVisible)
    }
  }

  private setupConn() {
    const c = this.conn
    if (!c) return
    // stale guard: a re-dial (join retry) replaces this.conn — events from
    // the abandoned attempt must not tear down the live one
    c.on('open', () => {
      if (c === this.conn) this.updateState('connected')
    })
    c.on('data', (data) => {
      if (c !== this.conn) return
      const msg = data as NetworkMessage
      // V30: RTT probes live in the transport layer — pong echoes instantly
      // regardless of which screen currently owns onMessage
      if (msg.type === 'ping') {
        this.send({ type: 'pong', t: msg.t })
        return
      }
      if (msg.type === 'pong') {
        this.rtt = Math.min(this.rtt, Date.now() - msg.t)
        return
      }
      this.onMessage(msg)
    })
    c.on('close', () => {
      if (c === this.conn) this.dropConn()
    })
    c.on('error', () => {
      if (c === this.conn) this.dropConn()
    })
  }

  private updateState(s: P2PState) {
    this.state = s
    this.onStateChange(s)
  }

  send(msg: NetworkMessage) {
    if (this.conn && this.state === 'connected') {
      this.conn.send(msg)
    }
  }

  /** B21: a dropped connection must NOT destroy a host's peer — the join id
   * stays valid so the other side can reconnect. Joiners fully reset. */
  private dropConn() {
    this.conn = null
    if (this.isHost && this.peer && !this.peer.destroyed) {
      this.updateState('hosting')
    } else if (!this.isHost && this.state === 'joining') {
      // V30: mid-retry — the join loop owns the lifecycle, keep the peer
    } else {
      this.disconnect()
    }
  }

  disconnect() {
    if (this.state === 'disconnected') return
    this.conn?.close()
    this.peer?.destroy()
    this.conn = null
    this.peer = null
    this.isHost = false
    this.peerId = null
    this.updateState('disconnected')
  }
}

export const network = new NetworkManager()

// T188: e2e harness probe (scripts/e2e-mp.mjs) — dev builds only
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __net: NetworkManager }).__net = network
}
