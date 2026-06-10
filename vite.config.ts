import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    // builtin-song render tests do real DSP work; default 5s flakes under load
    testTimeout: 20000,
  },
} as Parameters<typeof defineConfig>[0])
