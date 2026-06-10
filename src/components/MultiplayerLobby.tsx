import { useEffect, useState, useRef } from 'react'
import { useGame } from '../game/store'
import { network, type NetworkMessage, type P2PState } from '../lib/network/p2p'
import { BUNDLED_SONGS } from '../lib/audio/bundled'
import { startBundledRace, startFileRace } from '../game/flow'

export function MultiplayerLobby({ initialJoinId }: { initialJoinId?: string }) {
  const [p2pState, setP2pState] = useState<P2PState>(network.state)
  const [peerId, setPeerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    network.onStateChange = (s) => setP2pState(s)
    network.onMessage = (msg) => {
      handleNetworkMessage(msg).catch((e) => setError(String(e)))
    }

    if (initialJoinId) {
      network.join(initialJoinId)
    } else {
      network.host().then(setPeerId).catch((e) => setError(String(e)))
    }

    return () => {
      network.onStateChange = () => {}
      network.onMessage = () => {}
    }
  }, [initialJoinId])

  const handleNetworkMessage = async (msg: NetworkMessage) => {
    if (msg.type === 'lobby_song_builtin') {
      const song = BUNDLED_SONGS.find(s => s.id === msg.songId)
      if (song) {
        useGame.getState().setMultiplayer(true)
        await startBundledRace(song.url, song.title)
      }
    } else if (msg.type === 'lobby_song_custom') {
      const file = new File([msg.bytes], msg.title, { type: 'audio/mpeg' })
      useGame.getState().setMultiplayer(true)
      await startFileRace(file)
    }
  }

  const selectBuiltin = async (songId: string) => {
    network.send({ type: 'lobby_song_builtin', songId })
    const song = BUNDLED_SONGS.find(s => s.id === songId)
    if (song) {
      useGame.getState().setMultiplayer(true)
      await startBundledRace(song.url, song.title)
    }
  }

  const selectCustom = async (file: File | undefined) => {
    if (!file) return
    const bytes = await file.arrayBuffer()
    network.send({ type: 'lobby_song_custom', title: file.name, bytes })
    useGame.getState().setMultiplayer(true)
    await startFileRace(file)
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
          <div className="flex flex-col gap-4">
            <p className="text-center text-sm tracking-widest text-[#b4ff39]">OPPONENT CONNECTED!</p>
            <p className="text-xs tracking-widest text-white/50">SELECT TRACK TO BEGIN:</p>
            {BUNDLED_SONGS.map(song => (
              <button 
                key={song.id}
                onClick={() => void selectBuiltin(song.id)}
                className="border border-white/20 bg-black py-2 hover:bg-white/10"
              >
                {song.title}
              </button>
            ))}
            <button 
              onClick={() => fileInput.current?.click()}
              className="border border-dashed border-(--color-neon-2) py-2 text-(--color-neon-2) hover:bg-(--color-neon-2)/10"
            >
              UPLOAD CUSTOM TRACK
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => void selectCustom(e.target.files?.[0])}
            />
          </div>
        )}

        {p2pState === 'connected' && !network.isHost && (
          <div className="text-center">
            <p className="text-sm tracking-widest text-[#b4ff39]">CONNECTED TO HOST</p>
            <p className="mt-4 animate-pulse text-xs text-white/50">WAITING FOR HOST TO SELECT TRACK...</p>
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
