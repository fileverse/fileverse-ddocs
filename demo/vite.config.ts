import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep in sync with package/utils/is-allowed-embed-src.ts
const EMBED_FRAME_SRC = [
  "'self'",
  'https://www.youtube.com',
  'https://youtube.com',
  'https://www.youtube-nocookie.com',
  'https://youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://w.soundcloud.com',
].join(' ');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Content-Security-Policy': `frame-src ${EMBED_FRAME_SRC};`,
    },
  },
  preview: {
    headers: {
      'Content-Security-Policy': `frame-src ${EMBED_FRAME_SRC};`,
    },
  },
});
