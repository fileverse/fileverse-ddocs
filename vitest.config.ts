import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // demo files resolve a tsconfig without a `jsx` field — pin the automatic
  // runtime so JSX transforms identically everywhere.
  esbuild: { jsx: 'automatic' },
  resolve: {
    // When @fileverse/ui is npm-linked (local dev), it brings its own React
    // copy; pin everything to this repo's React so hooks share one instance.
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true, // RTL auto-cleanup registers via global afterEach

    setupFiles: ['./vitest.setup.ts'],
    include: ['package/**/*.test.{ts,tsx}', 'demo/src/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        // ships .module.css imports node can't load directly
        // usehooks-ts: the demo installs its own copy, which would load the
        // demo's React beside this repo's when a test renders the demo app;
        // inlined, it goes through the React alias above.
        inline: ['react-tweet', 'usehooks-ts'],
      },
    },
  },
});
