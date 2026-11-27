/**
 * Chunk grouping for the demo build.
 *
 * Matters more when the app is hosted on Swarm than on a CDN. Swarm is
 * content-addressed: a file that does not change keeps its reference, so it
 * costs no postage to re-upload and viewers' nodes already hold it. One
 * monolithic bundle throws that away — editing a single line reissues every
 * byte as new content, to be paid for and re-fetched.
 *
 * So the large dependencies that change only on a version bump are split
 * away from the app's own code, which changes every build. The groups are
 * coarse on purpose: dozens of tiny chunks would cost more in requests than
 * they save in bytes.
 *
 * Only statically-imported packages are grouped. Anything not named here
 * keeps Rollup's own placement — critically, that leaves code reachable
 * only through `import()` (Mermaid and its graph libraries, CodeMirror
 * behind the split view) in lazy chunks that a reader never downloads
 * unless they open the feature. Naming such a package here would quietly
 * pull ~2 MB into the initial load.
 */
export const manualChunks = (id: string): string | undefined => {
  if (!id.includes('node_modules')) return undefined;

  // Deliberately NOT grouped: Mermaid and its graph libraries. Something
  // in the eager graph statically imports one small helper from Mermaid,
  // so naming it here pulls all ~2.7 MB of diagram code into first load
  // (measured). Left ungrouped, Rollup keeps that helper in the entry
  // chunk and the diagram code stays in lazy chunks nobody downloads
  // unless they render a diagram.

  // React runtime — moves only on a React upgrade.
  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
    return 'vendor-react';
  }
  // Editor core: Tiptap, ProseMirror, Yjs and the collaboration protocol.
  if (
    /node_modules\/(@tiptap|prosemirror-|@_ueberdosis|yjs|y-protocols|y-prosemirror|y-indexeddb)/.test(
      id,
    )
  ) {
    return 'vendor-editor';
  }
  // Design system, icons, animation, emoji data.
  if (
    /node_modules\/(@fileverse\/ui|lucide-react|framer-motion|emojibase|frimousse)/.test(
      id,
    )
  ) {
    return 'vendor-ui';
  }
  // Crypto and chain access, including Swarm feed signing.
  if (
    /node_modules\/(viem|@noble|@scure|@stablelib|@fileverse\/crypto|@fileverse\/ens|abitype|ox)\//.test(
      id,
    )
  ) {
    return 'vendor-crypto';
  }
  // Document processing loaded with the editor: highlighting, math,
  // formatting, markdown, import/export. (No CodeMirror here — it belongs
  // to the lazily-loaded split view.)
  if (
    /node_modules\/(highlight\.js|lowlight|katex|prettier|markdown-it|turndown|mammoth|jszip|odf-kit)/.test(
      id,
    )
  ) {
    return 'vendor-docs';
  }
  return undefined;
};
