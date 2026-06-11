import { useEffect, useRef, useState } from 'react'
import { telemetry } from '../game/telemetry'

/**
 * T173: tiny perf readout — fps (500ms window), avg frame ms, worst frame,
 * and the REAL canvas resolution incl. device pixel ratio (the retina
 * per-pixel-budget factor that made the same scene 4× heavier on the
 * MacBook panel). Toggle with F2, or load with ?perf. Writes DOM directly
 * from its own rAF — zero React re-renders.
 */
export function PerfHud() {
  const [on, setOn] = useState(() => window.location.search.includes('perf'))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.code === 'F2') setOn((o) => !o)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // long tasks (>50ms main-thread blocks) — the usual hitch culprit
  const longTasks = useRef(0)
  useEffect(() => {
    if (!on || typeof PerformanceObserver === 'undefined') return
    try {
      const obs = new PerformanceObserver((list) => {
        longTasks.current += list.getEntries().length
      })
      obs.observe({ entryTypes: ['longtask'] })
      return () => obs.disconnect()
    } catch {
      /* longtask unsupported — counter stays 0 */
    }
  }, [on])

  useEffect(() => {
    if (!on) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    let n = 0
    let worst = 0
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick)
      const dt = ts - last
      last = ts
      acc += dt
      n++
      if (dt > worst) worst = dt
      if (acc >= 500 && ref.current) {
        const avg = acc / n
        const c = document.querySelector('canvas')
        const mpix = c ? ((c.width * c.height) / 1e6).toFixed(1) : '0'
        // gpu = measured render time on the GPU (timestamp queries), the
        // number that matters — rAF fps just mirrors vsync
        const gpu = telemetry.gpuMs > 0 ? ` · gpu ${telemetry.gpuMs.toFixed(1)}` : ''
        const cpu = telemetry.cpuMs > 0 ? ` cpu ${telemetry.cpuMs.toFixed(1)}` : ''
        const lt = longTasks.current > 0 ? ` lt${longTasks.current}` : ''
        const dc = telemetry.drawCalls > 0 ? ` ${telemetry.drawCalls}dc ${(telemetry.triangles / 1000).toFixed(0)}kt` : ''
        const ck = telemetry.chunksDrawn > 0 ? ` ${telemetry.chunksDrawn}ck` : ''
        // T173: JS heap (Chrome incl. Android) — a sawtooth here during the
        // "sometimes choppy" moments = GC pressure, not GPU
        type PerfMem = { memory?: { usedJSHeapSize: number } }
        const heap = (performance as unknown as PerfMem).memory
        const mem = heap ? ` ${(heap.usedJSHeapSize / 1048576).toFixed(0)}MB` : ''
        ref.current.textContent = `${Math.round(1000 / avg)}fps ${avg.toFixed(1)}ms ▲${worst.toFixed(0)}${gpu}${cpu}${lt}${dc}${ck}${mem} · ${c?.width ?? 0}×${c?.height ?? 0} (${mpix}MP) @${(window.devicePixelRatio || 1).toFixed(1)}x`
        acc = 0
        n = 0
        worst = 0
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [on])

  if (!on) return null
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed bottom-1 left-1 z-50 rounded border border-white/15 bg-black px-2 py-1 font-mono text-[11px] tracking-tight text-white/90"
    />
  )
}
