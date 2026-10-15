import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import pkg from './package.json';

// Stays bundled: the Tiptap/ProseMirror engine (consumer installs float Tiptap's
// caret ranges and would split @tiptap/core), react-tweet (its JS imports CSS)
// and mammoth (its Node build rejects the { arrayBuffer } input we pass).
const isBundled = (name: string) =>
  name.startsWith('@tiptap/') ||
  name.startsWith('prosemirror-') ||
  [
    '@_ueberdosis/prosemirror-tables',
    '@aarkue/tiptap-math-extension',
    'mammoth',
    'react-tweet',
    'tiptap-markdown',
    'y-prosemirror',
  ].includes(name);

// Every other declared dependency stays external so the consumer's bundler
// resolves, dedupes and tree-shakes it. CSS from deps still goes into style.css;
// JSON is bundled too, since Node ESM cannot import it without an attribute.
const externalPackages = [
  ...Object.keys(pkg.dependencies),
  ...Object.keys(pkg.peerDependencies),
].filter((name) => !isBundled(name));

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
      entry: {
        index: path.resolve(__dirname, './index.ts'),
        'headless-editor-utils': path.resolve(
          __dirname,
          './headless-editor-utils.ts',
        ),
      },
      formats: ['es'],
      //A function that generates the output file
      //name for different formats during the build
      fileName: (format, entryName) => `${entryName}.${format}.js`,
    },
    rollupOptions: {
      // Subpath imports (react/jsx-runtime etc.) must stay external too —
      // inlining them breaks under React 19 (React 18-only internals).
      external: (id) =>
        !/\.(css|json)$/.test(id) &&
        externalPackages.some(
          (name) => id === name || id.startsWith(`${name}/`),
        ),
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
