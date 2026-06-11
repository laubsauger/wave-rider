import { Canvas, extend, useThree, type ThreeToJSXElements } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import { useEffect, type ReactNode } from 'react'

declare module '@react-three/fiber' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0])

/**
 * T173/B-class perf fix: the r3f `dpr` prop gets LOST during the async
 * WebGPU renderer init — the canvas came up at pixelRatio 1 and only jumped
 * to the requested dpr after the first window resize. Resolution (and the
 * whole quality tier) was effectively random per session. This child applies
 * it deterministically after mount, capped at the device ratio (rendering
 * above native is pure waste — invisible by definition).
 */
function DprSync({ dpr }: { dpr: number }) {
  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => {
    setDpr(Math.min(dpr, window.devicePixelRatio || 1))
  }, [dpr, setDpr])
  return null
}

/** WebGPU-only canvas (C2). Callers must have passed detectWebGPU first. */
export function GpuCanvas({
  children,
  alpha = false,
  dpr,
  antialias = true,
  ...rest
}: { children: ReactNode; alpha?: boolean; dpr?: number; antialias?: boolean } & Record<string, unknown>) {
  return (
    <Canvas
      {...rest}
      flat={false}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          ...(props as ConstructorParameters<typeof THREE.WebGPURenderer>[0]),
          // T173: MSAA is a major mobile fill-rate cost — low/medium tiers
          // drop it (the post chain's blur/CA hides aliasing anyway)
          antialias,
          forceWebGL: false,
          alpha,
          // T173: GPU timestamp queries — PerfHud reads REAL gpu frame ms,
          // not rAF pacing (which just mirrors the display's vsync)
          trackTimestamp: true,
        })
        await renderer.init()
        return renderer
      }}
    >
      <DprSync dpr={typeof dpr === 'number' ? dpr : 2} />
      {children}
    </Canvas>
  )
}
