import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { manualChunks } from './vendor-chunks'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Split rarely-changing dependencies away from app code: on Swarm,
    // unchanged chunks keep their reference, so a rebuild only pays
    // postage for what actually changed. See vendor-chunks.ts.
    rollupOptions: { output: { manualChunks } },
  },
})
