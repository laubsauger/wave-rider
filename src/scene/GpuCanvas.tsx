import { Canvas, extend, type ThreeToJSXElements } from '@react-three/fiber'
import * as THREE from 'three/webgpu'
import type { ReactNode } from 'react'

declare module '@react-three/fiber' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ThreeElements extends ThreeToJSXElements<typeof THREE> {}
}

extend(THREE as unknown as Parameters<typeof extend>[0])

/** WebGPU-only canvas (C2). Callers must have passed detectWebGPU first. */
export function GpuCanvas({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) {
  return (
    <Canvas
      {...rest}
      flat={false}
      gl={async (props) => {
        const renderer = new THREE.WebGPURenderer({
          ...(props as ConstructorParameters<typeof THREE.WebGPURenderer>[0]),
          antialias: true,
          forceWebGL: false,
        })
        await renderer.init()
        return renderer
      }}
    >
      {children}
    </Canvas>
  )
}
