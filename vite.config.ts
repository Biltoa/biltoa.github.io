import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base '/' — deploying to the root of ahmadbilto.com.
// If this ever moves to a GitHub Pages project repo, set base: '/repo-name/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    headers: {
      // Unity WebGL builds that use threads need these. Harmless otherwise.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          r3f: ['@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
})
