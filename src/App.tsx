import { useEffect } from 'react'
import { useGame } from './game/store'
import { detectWebGPU } from './lib/webgpu'
import { Unsupported } from './components/Unsupported'
import { Menu } from './components/Menu'
import { Analyzing } from './components/Analyzing'
import { Race } from './components/Race'
import { Results } from './components/Results'
import { RotateOverlay } from './components/RotateOverlay'

export default function App() {
  const screen = useGame((s) => s.screen)
  const setScreen = useGame((s) => s.setScreen)

  useEffect(() => {
    if (screen !== 'boot') return
    detectWebGPU().then((ok) => setScreen(ok ? 'menu' : 'unsupported'))
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
      {screen === 'analyzing' && <Analyzing />}
      {screen === 'race' && <Race />}
      {screen === 'results' && <Results />}
      {screen !== 'race' && <RotateOverlay />}
    </div>
  )
}
