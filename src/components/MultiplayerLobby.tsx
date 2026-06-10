import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { network, type NetworkMessage, type P2PState } from '../lib/network/p2p'
import { BUNDLED_SONGS } from '../lib/audio/bundled'
import { startBundledRace, startFileRace } from '../game/flow'

export function MultiplayerLobby({ initialJoinId }: { initialJoinId?: string }) {
  const [p2pState, setP2pState] = useState<P2PState>(network.state)
  const [peerId, setPeerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [oppStatus, setOppStatus] = useState<string | null>(null)

  useEffect(() => {
    network.onError = setError
    return () => {
      network.onError = () => {}
    }
  }, [])

  useEffect(() => {
    const handleState = (s: P2PState) => {
      setP2pState(s)
      if (s === 'connected' && network.isHost) {
        const state = useGame.getState()
        const title = state.songTitle
        const builtin = BUNDLED_SONGS.find((song) => song.title === title)
        if (builtin) {
          network.send({ type: 'lobby_song_builtin', songId: builtin.id })
        } else {
          const userSong = state.userSongs.find((song) => song.title === title)
          if (userSong) {
            // T88: tiny status lands before the heavy bytes — joiner sees a
            // download indicator instead of "waiting for host"
            network.send({
              type: 'status',
              text: `HOST SENDING TRACK (${(userSong.bytes.byteLength / 1e6).toFixed(1)} MB)…`,
            })
            network.send({ type: 'lobby_song_custom', title: userSong.title, bytes: userSong.bytes })
          } else {
            setError('Could not find track bytes to send!')
            return
          }
        }
        state.startRace()
      }
    }

    const handleMsg = (msg: NetworkMessage) => {
      handleNetworkMessage(msg).catch((e) => setError(String(e)))
    }

    network.onStateChange = handleState
    network.onMessage = handleMsg

    if (initialJoinId) {
      network.join(initialJoinId)
    } else {
      network.host().then(setPeerId).catch((e) => setError(String(e)))
    }

    return () => {
      if (network.onStateChange === handleState) network.onStateChange = () => {}
      if (network.onMessage === handleMsg) network.onMessage = () => {}
    }
  }, [initialJoinId])

  const handleNetworkMessage = async (msg: NetworkMessage) => {
    if (msg.type === 'status') {
      setOppStatus(msg.text)
      return
    }
    if (msg.type === 'lobby_song_builtin') {
      const song = BUNDLED_SONGS.find(s => s.id === msg.songId)
      if (song) {
        useGame.getState().setMultiplayer(true, false)
        await startBundledRace(song.url, song.title)
      }
    } else if (msg.type === 'lobby_song_custom') {
      network.send({ type: 'status', text: 'OPPONENT ANALYZING TRACK…' })
      const file = new File([msg.bytes], msg.title, { type: 'audio/mpeg' })
      useGame.getState().setMultiplayer(true, false)
      await startFileRace(file)
    }
  }

  const cancel = () => {
    network.disconnect()
    useGame.getState().setScreen('menu')
  }

  const shareUrl = peerId ? `${window.location.origin}${window.location.pathname}?join=${peerId}` : ''

  return (
    <div className="hud-safe absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-8 text-white">
      <h1 className="text-4xl font-bold tracking-[0.2em] text-(--color-neon)">MULTIPLAYER LOBBY</h1>
      
      <div className="mt-8 flex w-full max-w-lg flex-col gap-6 border border-white/20 bg-white/5 p-6">
        <p className="text-center text-sm tracking-widest text-white/60">
          STATUS: <span className="text-white">{p2pState.toUpperCase()}</span>
        </p>

        {error && <p className="text-red-400">{error}</p>}

        {p2pState === 'hosting' && (
          <div className="text-center">
            <p className="mb-2 text-xs tracking-widest text-white/50">SHARE THIS LINK WITH YOUR OPPONENT:</p>
            <input 
              readOnly 
              value={shareUrl} 
              className="w-full bg-black px-4 py-2 text-center font-mono text-sm text-(--color-neon)"
              onClick={e => (e.target as HTMLInputElement).select()}
            />
            <p className="mt-4 text-xs text-white/40">Waiting for them to connect...</p>
          </div>
        )}

        {p2pState === 'connected' && network.isHost && (
          <div className="text-center">
            <p className="text-sm tracking-widest text-[#b4ff39]">OPPONENT CONNECTED!</p>
            <p className="mt-4 animate-pulse text-xs text-white/50">SENDING TRACK DATA...</p>
          </div>
        )}

        {p2pState === 'connected' && !network.isHost && (
          <div className="text-center">
            <p className="text-sm tracking-widest text-[#b4ff39]">CONNECTED TO HOST</p>
            <p className="mt-4 animate-pulse text-xs text-white/50">{oppStatus ?? 'WAITING FOR HOST TO SELECT TRACK...'}</p>
          </div>
        )}

        <button 
          onClick={cancel}
          className="mt-4 self-center border-b border-white/30 pb-1 text-xs tracking-widest text-white/50 hover:text-white"
        >
          CANCEL / LEAVE
        </button>
      </div>
    </div>
  )
}
