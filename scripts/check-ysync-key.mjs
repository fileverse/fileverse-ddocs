// TIPTAP_UPGRADE.md §5.10.3 (a): the built bundle must register y-sync under
// 'y-sync$', which our code string-matches. Run after `npm run build`.
/* eslint-env node */
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) globalThis[key] = window[key];
}

// Not a React hook: useHeadlessEditor only returns createHeadlessEditorRuntime().
const { useHeadlessEditor: headlessRuntime } = await import(
  '../dist/index.es.js'
);
const { editor } = headlessRuntime().getEditor({ schemaVersion: 2 });
const ok = editor.state['y-sync$'] !== undefined;
editor.destroy();
console.log(ok ? 'y-sync$ found' : "y-sync$ missing from the editor's state");
process.exit(ok ? 0 : 1);
