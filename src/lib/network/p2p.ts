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
  | { type: 'lobby_song_custom', title: string, bytes: ArrayBuffer }
  | { type: 'lobby_ready' }
  | { type: 'race_start', startTime: number }
  | { type: 'state_update', state: OpponentState }
  | { type: 'race_finish', timeMs: number }

export class NetworkManager {
  peer: Peer | null = null
  conn: DataConnection | null = null
  state: P2PState = 'disconnected'
  isHost = false
  peerId: string | null = null
  
  onStateChange: (state: P2PState) => void = () => {}
  onMessage: (msg: NetworkMessage) => void = () => {}

  async host(): Promise<string> {
    this.isHost = true
    this.updateState('hosting')
    return new Promise((resolve, reject) => {
      this.peer = new Peer()
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
    this.peer.on('open', () => {
      this.conn = this.peer!.connect(hostId, { reliable: true })
      this.setupConn()
    })
    this.peer.on('error', (err) => {
      console.error('Peer error', err)
      this.disconnect()
    })
  }

  private setupConn() {
    if (!this.conn) return
    this.conn.on('open', () => {
      this.updateState('connected')
    })
    this.conn.on('data', (data) => {
      this.onMessage(data as NetworkMessage)
    })
    this.conn.on('close', () => {
      this.disconnect()
    })
    this.conn.on('error', () => {
      this.disconnect()
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
