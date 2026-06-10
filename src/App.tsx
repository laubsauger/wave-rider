import { useEffect } from 'react'
import { useGame } from './game/store'
import { detectWebGPU } from './lib/webgpu'
import { Unsupported } from './components/Unsupported'
import { Menu } from './components/Menu'
import { Analyzing } from './components/Analyzing'
import { Race } from './components/Race'
import { Results } from './components/Results'
import { RotateOverlay } from './components/RotateOverlay'
import { MultiplayerLobby } from './components/MultiplayerLobby'
import { deserializeGhost } from './lib/network/ghost'

export default function App() {
  const screen = useGame((s) => s.screen)
  const setScreen = useGame((s) => s.setScreen)

  useEffect(() => {
    if (screen !== 'boot') return
    detectWebGPU().then((ok) => {
      if (!ok) {
        setScreen('unsupported')
        return
      }
      
      const params = new URLSearchParams(window.location.search)
      const joinId = params.get('join')
      const ghostData = params.get('ghost')

      if (joinId) {
        setScreen('multiplayer-lobby')
      } else if (ghostData) {
        deserializeGhost(ghostData)
          .then(data => {
            useGame.getState().setGhostPlayback(data)
            setScreen('menu')
          })
          .catch(e => {
            console.error('Invalid ghost data', e)
            setScreen('menu')
          })
      } else {
        setScreen('menu')
      }
    })
  }, [screen, setScreen])

  return (
    <div className="relative h-full">
      {screen === 'boot' && (
        <div className="flex h-full items-center justify-center">
          <span className="animate-pulse tracking-[0.5em] text-white/50">INITIALIZING</span>
        </div>
      )}
      {screen === 'unsupported' && <Unsupported />}
      {screen === 'menu' && <Menu />}
      {screen === 'multiplayer-lobby' && <MultiplayerLobby initialJoinId={new URLSearchParams(window.location.search).get('join') || undefined} />}
      {screen === 'analyzing' && <Analyzing />}
      {screen === 'race' && <Race />}
      {screen === 'results' && <Results />}
      {screen !== 'race' && <RotateOverlay />}
    </div>
  )
}
