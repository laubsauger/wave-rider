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
import { TrackSetup } from './components/TrackSetup'
import { GhostLobby } from './components/GhostLobby'
import { PerfHud } from './components/PerfHud'
import { deserializeGhost } from './lib/network/ghost'
import { GpuCanvas } from './scene/GpuCanvas'
import { MenuBackdrop } from './scene/MenuBackdrop'

/** T110/T144: ONE persistent backdrop canvas behind every non-race screen —
 * including the menu — so screen swaps never flash to black */
const BACKDROP_SCREENS = new Set(['menu', 'track-setup', 'multiplayer-lobby', 'ghost-lobby', 'analyzing', 'results'])

/** boot routing must run ONCE: StrictMode double-fires the effect and the
 * second pass reads the already-scrubbed URL → stomped the join/ghost route */
let booted = false

export default function App() {
  const screen = useGame((s) => s.screen)
  const setScreen = useGame((s) => s.setScreen)

  useEffect(() => {
    if (screen !== 'boot') return
    detectWebGPU().then((ok) => {
      if (booted) return
      booted = true
      if (!ok) {
        setScreen('unsupported')
        return
      }

      const params = new URLSearchParams(window.location.search)
      const joinId = params.get('join')
      const ghostData = params.get('ghost')

      if (joinId) {
        // consume-once: a lingering ?join= made every later lobby visit
        // (e.g. "host multiplayer") silently JOIN the stale peer instead
        useGame.getState().setPendingJoinId(joinId)
        window.history.replaceState({}, '', window.location.pathname)
        setScreen('multiplayer-lobby')
      } else if (ghostData) {
        deserializeGhost(ghostData)
          .then(data => {
            useGame.getState().setGhostPlayback(data)
            window.history.replaceState({}, '', window.location.pathname)
            setScreen('ghost-lobby')
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
      {/* B26: backdrop is positioned → paints OVER static-flow screens
          (Results) and ate their clicks. Never interactive. */}
      {BACKDROP_SCREENS.has(screen) && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <GpuCanvas camera={{ position: [0, 1.2, 5], fov: 50 }}>
            <MenuBackdrop />
          </GpuCanvas>
        </div>
      )}
      {screen === 'menu' && <Menu />}
      {screen === 'multiplayer-lobby' && <MultiplayerLobby />}
      {screen === 'track-setup' && <TrackSetup />}
      {screen === 'ghost-lobby' && <GhostLobby />}
      {screen === 'analyzing' && <Analyzing />}
      {screen === 'race' && <Race />}
      {screen === 'results' && <Results />}
      {screen !== 'race' && <RotateOverlay />}
      {/* T173: F2 or ?perf — fps + frame ms + real canvas pixels */}
      <PerfHud />
    </div>
  )
}
