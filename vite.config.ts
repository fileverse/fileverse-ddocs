import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

export default defineConfig({
  mode: process.env.NODE_ENV,
  resolve: {
    dedupe: ['yjs'],
  },
  build: {
    //Specifies that the output of the build will be a library.
    lib: {
      //Defines the entry point for the library build. It resolves
      //to src/index.ts,indicating that the library starts from this file.
      name: 'ddoc',
      entry: path.resolve(__dirname, './index.ts'),
      formats: ['es'],
      //A function that generates the output file
      //name for different formats during the build
      fileName: (format) => `index.${format}.js`,
    },
    rollupOptions: {
      external: (id) =>
        [
          'react',
          'react-dom',
          '@fileverse/ui',
          'framer-motion',
          'frimousse',
          'mermaid',
        ].includes(id) ||
        // Subpath imports (react/jsx-runtime etc.) must stay external too —
        // inlining them breaks under React 19 (React 18-only internals).
        id.startsWith('react/') ||
        id.startsWith('react-dom/') ||
        id === 'yjs' ||
        id.startsWith('yjs/') ||
        id.startsWith('@fileverse/crypto') ||
        id.startsWith('@dnd-kit/') ||
        id.startsWith('viem'),
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
        },
      },
    },
    //Generates sourcemaps for the built files,
    //aiding in debugging.
    sourcemap: false,
    //Clears the output directory before building.
    emptyOutDir: true,
  },
  //react() enables React support.
  //dts() generates TypeScript declaration files (*.d.ts)
  //during the build.
  plugins: [react(), dts()],
  define: {
    'process:env.NODE_ENV': JSON.stringify('production'),
  },
});
