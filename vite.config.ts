import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  base: process.env.GITHUB_ACTIONS ? '/wave-rider/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    // bare 'three' (lib core, addons, r3f) and 'three/webgpu' (scene) pulled
    // in TWO copies of three — "Multiple instances" warning + bundle bloat.
    // Alias bare 'three' to the webgpu build (superset re-export) so one
    // instance serves all. Skipped in tests: node has no WebGPU globals.
    alias: mode === 'test' ? [] : [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    // builtin-song render tests do real DSP work; default 5s flakes under load
    testTimeout: 20000,
  },
}) as Parameters<typeof defineConfig>[0])
