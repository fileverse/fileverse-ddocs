# Fileverse dDocs
[ddocs.new](http://ddocs.new/) is your privacy-focused, open-source alternative to Google Docs. It is an end-to-end encrypted document editor that is optimized for multiplayer collaboration without compromising on speed or people's control over their data.

## 𓆏 Features include:
- End-to-end encryption with post-quantum cryptography
- Real-time and async collaboration
- Suggestion mode (tracked changes) and commenting
- Markdown and LaTeX support
- MermaidJS diagram support
- Import/export of .docx, .md, .pdf, .html and more.
- Dark mode and color themes
- Offline/online editing (continue writing and opening older docs even with no WiFi)
- Cross-device syncing (desktop and mobile)
- Mobile optimized webapp & PWA
- Private access permissions enabled through zero-knowledge proofs
- Private social recovery of account/files, enabled through zero-knowledge proofs
- Version history
- End-to-end encrypted, programmable API optimised for agents (opt-in)

<img width="1574" height="981" alt="ddocsNew" src="https://github.com/user-attachments/assets/b7a344c1-8c86-4735-9181-d0c22a5c4ff6" />


This repository contains:

- `/package` – The core package code.
- Example & demo source code to showcase dDocs functionalities.

## Usage

### Prerequisites

Your app runs Tailwind CSS 3.4 and owns the `@tailwind base/components/utilities` entry. The package ships only editor CSS; preflight, utilities, the `@fileverse/ui` styles, and the KaTeX stylesheet come from your build.

### Install & import

```javascript
import { DdocEditor } from '@fileverse-dev/ddoc';
```

Load stylesheets in this order (Vite emits CSS in import order; in Next put the first two in the root layout and the last two in the editor route):

```javascript
import './globals.css';                 // your tailwind entry
import '@fileverse/ui/styles/base';     // tokens and base rules
import 'katex/dist/katex.min.css';      // math; fonts are served as files
import '@fileverse-dev/ddoc/styles';    // editor CSS
```

### Sizing

`DdocEditor` fills its parent: `width: 100%; height: 100%`. The parent must have a definite height. The editor never reads the viewport, so a navbar above it or a footer below it is ordinary layout:

```tsx
<div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
  <div style={{ flex: 1, minHeight: 0 }}>
    <DdocEditor renderNavbar={renderNavbar} />
  </div>
  <footer>…</footer>
</div>
```

If the editor renders with no height, its parent has none.

`renderNavbar` output is the editor's first row by default. Without `renderNavbar` no navbar element is rendered. To place the navbar elsewhere, pass the element to render into. Hold it in state, not in a ref, so the editor re-renders when it attaches:

```tsx
const [navbarEl, setNavbarEl] = useState<HTMLElement | null>(null);

<header ref={setNavbarEl} />
<DdocEditor navbarContainer={navbarEl} renderNavbar={renderNavbar} />
```

The layout follows the editor's width, not the window's: in a narrow panel it uses its narrow layout. Known limits: one `DdocEditor` per page; in a narrow editor on a wide screen the comment sheet still covers the whole viewport.

### Peer Dependencies

This package requires the following peer dependencies to be installed in your project:

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @fileverse/ui @fileverse/crypto viem framer-motion frimousse
```

| Package              | Version     |
| -------------------- | ----------- |
| `@dnd-kit/core`      | `>=6.3.1`   |
| `@dnd-kit/sortable`  | `>=10.0.0`  |
| `@dnd-kit/utilities` | `>=3.2.2`   |
| `@fileverse/ui`      | `^5.4.2`    |
| `@fileverse/crypto`  | `>=0.0.21`  |
| `viem`               | `>=2.13.8`  |
| `framer-motion`      | `>=11.2.10` |
| `frimousse`          | `>=0.3.0`   |

The peer range is `@fileverse/ui@^5.4.2`. If you ever test a prerelease pairing, pin both packages exactly: a prerelease never satisfies a caret range.

These are externalized from the bundle to avoid duplication when your app already uses them. If you don't have them installed, npm (v7+) will auto-install them for you.

### Update Tailwind Config

```javascript
module.exports = {
  presets: [require('@fileverse-dev/ddoc/tailwind')],
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './node_modules/@fileverse-dev/ddoc/dist/**/*.{js,mjs}',
    './node_modules/@fileverse/ui/dist/**/*.{js,mjs}',
  ],
};
```

Both dist globs are required, not the single `index.es.js` entry: the dist is chunked (`index.es.js`
statically imports `use-headless-editor-<hash>.mjs`), so a single-file entry leaves that chunk's
classes ungenerated.

The preset composes `@fileverse/ui/tailwind` (class-based dark mode, animate plugin, design-system classes) and adds the `mobile: 960px` screen the editor uses.

`tailwindcss@^3.4.0` is an optional peer: the preset runs inside your own Tailwind build, which also supplies the `postcss` and `postcss-js` the ui preset loads. Tailwind 4 is not supported.

### Migrating from 4.x

5.0 stops shipping preflight, Tailwind utilities, the ui stylesheet, the KaTeX stylesheet, and the `html`, `body`, and `*` resets. To upgrade:

1. Add the preset and the two `content` entries above.
2. Import `@fileverse/ui/styles/base` and `katex/dist/katex.min.css` yourself, in the order above.
3. The package no longer ships these global declarations:
   - `* { margin: 0; padding: 0 }`
   - `html, body { height: 100%; width: 100% }`
   - `html, body { overflow: hidden }`
   - `body { position: static; user-select: none; -moz-osx-font-smoothing: grayscale }`
   - `*, ::before, ::after { border-color: hsl(var(--color-border-default)) }`

   If your shell relied on `overflow: hidden` or `user-select: none`, add them to your own
   global stylesheet. The rest are covered by Tailwind preflight or the `@fileverse/ui/styles/base`
   sheet.
4. Remove any workaround that re-declared `mobile:` classes; the preset generates them.
5. Add `katex` to your own dependencies (`npm install katex@^0.16.11`); the package no longer guarantees it is hoisted.
6. If you styled anything from the old bundle by class name: `.custom-scrollbar` is now `.ddoc-scrollbar`, and `.highlight-comment-bg`, `.is-active`, `.custom-border-bg`, `.animate-fade-in-out`, `.placeholder-disabled`, `.tooltip:before` were removed as unused.
7. The composed `@fileverse/ui` preset defines `rounded-sm` as `calc(var(--radius) - 4px)` (4px)
   instead of Tailwind's default 2px, so any surface using ddoc's `rounded-sm` utilities now
   renders 4px corners.
8. Third-party CSS ddoc imports (the highlight.js theme, tippy) still ships global `.hljs*` and
   `.tippy-box` selectors — this is outside the package's own selector-ownership guarantee.
9. List rules (`ul`, `ol`, and the nested-list counters) are now scoped to
   `:where(.ProseMirror, .presentation-mode)` and no longer style `ol`/`ul` outside the editor or
   presentation surfaces. If your app relied on ddoc's global list rules elsewhere, own them yourself.

You should now be set to use dDocs!

### Migrating from 5.x

6.0 changes how the editor is sized. No prop was removed.

- Give the editor a parent with a definite height (see Sizing). It no longer sizes itself from `100dvh`.
- Put your footer after the editor in normal flow. `footerHeight` has no effect and can be removed.
- The navbar and toolbars are no longer inside `#editor-canvas`. CSS that used `#editor-canvas` as their ancestor should use `.ddoc-editor-root`.
- Without `renderNavbar` the editor renders no navbar element at all. The navbar's height now comes from its content; it was a fixed 64px, 46px below `lg`.
- `editorCanvasClassNames` should not set a height.
- `zoomLevel`, `isNavbarVisible` and `isPreviewMode` are optional. Every UI state can be left out, or controlled with a value and an `onXChange` callback. The `setX` props still work and are deprecated.
- Your Tailwind build needs no config change. The new `ddoc-*` variants (container-query breakpoints that follow the editor's width) come from the `@fileverse-dev/ddoc/tailwind` preset you already use.

Behaviour that changes without a code change on your side:

- UI features that did nothing without their `setX` prop now work on internal state. The Split View toggle shows whenever live collaboration is off (it needed `setIsSplitView` before), and the comment drawer, the outline and presentation mode open without a setter. To keep one fixed, pass its value with no callback, for example `isPresentationMode={false}`. For Split View, `isSplitView={false}` keeps the editor out of Split View, but the toolbar toggle is still shown and does nothing.
- `onFocusModeChange` and the deprecated `onFocusMode` also fire when `isFocusMode` is not passed.
- `#editor-canvas` is now the document scroller (it carries `data-editor-scroll-container`), and the root (`.ddoc-editor-root`) is `overflow: hidden`.
- A navbar portalled with `navbarContainer` is positioned and layered by you; the editor only renders into the element.
- The navbar and toolbars no longer slide or fade when hidden; their rows are removed and the canvas takes the space.
- The mobile tab panel sits at the editor's bottom edge. It no longer adds `24px + env(safe-area-inset-bottom)`, so your footer must carry the safe-area inset.
- The editor's responsive classes use `:where()` in their window fallback, so they need Chrome 88+, Safari 14+ or Firefox 78+.

# dDocProps Interface

The `DdocProps` interface is a TypeScript interface that defines the properties for a page-related component. It includes properties for handling preview mode, managing publishing data, and optionally storing metadata and content associated with the page.

## Core Props

| Property                 | Type                                          | Description                                     |
| ------------------------ | --------------------------------------------- | ----------------------------------------------- |
| `initialContent`         | `JSONContent`                                 | Initial content of the editor                   |
| `onChange`               | `(changes: JSONContent, chunk?: any) => void` | Callback triggered on editor content changes    |
| `ref`                    | `React.RefObject`                             | Reference to access editor instance             |
| `isPreviewMode`          | `boolean`                                     | Controls if editor is in preview/read-only mode. Optional, defaults to `false` |
| `editorCanvasClassNames` | `string`                                      | Additional CSS classes for editor canvas        |
| `ignoreCorruptedData`    | `boolean`                                     | Whether to ignore corrupted data during loading |
| `onInvalidContentError`  | `(error: any) => void`                        | Callback for handling invalid content errors    |

## Collaboration Props

| Property               | Type                                          | Description                                                               |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `enableCollaboration`  | `boolean`                                     | Enables real-time collaboration features                                  |
| `collaborationId`      | `string`                                      | Unique ID for collaboration session (required when collaboration enabled) |
| `username`             | `string`                                      | User's display name for collaboration                                     |
| `setUsername`          | `(username: string) => void`                  | Function to update username                                               |
| `walletAddress`        | `string`                                      | User's wallet address                                                     |
| `onCollaboratorChange` | `(collaborators?: IDocCollabUsers[]) => void` | Callback when collaborators change                                        |
| `enableIndexeddbSync`  | `boolean`                                     | Enables IndexedDB sync for offline support                                |
| `ddocId`               | `string`                                      | Unique document ID (required for IndexedDB sync)                          |

## UI/UX Props

Every UI state can be left out (the editor keeps it internally), or controlled with a value and an `onXChange` callback. The `setX` props still work and are deprecated.

| Property                    | Type                                      | Description                                                                         |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `zoomLevel`                 | `string`                                  | Current zoom level of the editor. Optional, defaults to `'1'`                       |
| `onZoomLevelChange`         | `(zoomLevel: string) => void`             | Zoom changed                                                                        |
| `setZoomLevel`              | `React.Dispatch<SetStateAction<string>>`  | Deprecated, use `onZoomLevelChange`                                                 |
| `isNavbarVisible`           | `boolean`                                 | Controls navbar visibility. Optional, defaults to `true`                            |
| `onNavbarVisibleChange`     | `(visible: boolean) => void`              | Navbar shown or hidden                                                              |
| `setIsNavbarVisible`        | `React.Dispatch<SetStateAction<boolean>>` | Deprecated, use `onNavbarVisibleChange`                                             |
| `renderNavbar`              | `() => JSX.Element`                       | Custom navbar renderer. Without it no navbar is rendered                            |
| `navbarContainer`           | `HTMLElement \| null`                     | Element to render the navbar into. Omit for in-flow. `null` renders nothing until it attaches |
| `renderThemeToggle`         | `() => JSX.Element`                       | Custom theme toggle renderer                                                        |
| `showTOC`                   | `boolean`                                 | Controls the outline                                                                |
| `onShowTOCChange`           | `(show: boolean) => void`                 | Outline shown or hidden                                                             |
| `setShowTOC`                | `React.Dispatch<SetStateAction<boolean>>` | Deprecated, use `onShowTOCChange`                                                   |
| `commentDrawerOpen`         | `boolean`                                 | Controls the comment drawer                                                         |
| `onCommentDrawerOpenChange` | `(open: boolean) => void`                 | Comment drawer opened or closed                                                     |
| `setCommentDrawerOpen`      | `React.Dispatch<SetStateAction<boolean>>` | Deprecated, use `onCommentDrawerOpenChange`                                         |
| `isPresentationMode`        | `boolean`                                 | Controls presentation mode                                                          |
| `onPresentationModeChange`  | `(active: boolean) => void`               | Presentation mode entered or left                                                   |
| `setIsPresentationMode`     | `React.Dispatch<SetStateAction<boolean>>` | Deprecated, use `onPresentationModeChange`                                          |
| `isSplitView`               | `boolean`                                 | Controls Split View                                                                 |
| `onSplitViewChange`         | `(active: boolean) => void`               | Split View entered or left                                                          |
| `setIsSplitView`            | `React.Dispatch<SetStateAction<boolean>>` | Deprecated, use `onSplitViewChange`                                                 |
| `isFocusMode`               | `boolean`                                 | Controls focus mode                                                                 |
| `onFocusModeChange`         | `(isFocusMode: boolean) => void`          | Focus mode changed                                                                  |
| `onFocusMode`               | `(isFocusMode: boolean) => void`          | Deprecated, use `onFocusModeChange`                                                 |
| `onStatsChange`             | `(stats: { words; characters; selectedWords; pages: number \| null }) => void` | Active-tab stats; fires when any field changes. `pages` is `null` until measured |
| `setWordCount`, `setCharacterCount`, `setSelectedWordCount`, `setPageCount` | `React.Dispatch<SetStateAction<number>>` | Deprecated, use `onStatsChange` |
| `footerHeight`              | `string`                                  | Deprecated, no effect. Put the footer after the editor in normal flow               |
| `sharedSlidesLink`          | `string`                                  | Link for shared presentation slides                                                 |
| `documentStyling`           | `DocumentStyling`                         | Custom styling for document appearance                                              |
| `fonts`                     | `FontDescriptor[]`                        | Consumer-provided font catalog (see Custom Fonts)                                   |

## Document Styling

The `documentStyling` prop allows you to customize the visual appearance of your document with three distinct styling areas:

```typescript
interface ThemeVariantValue {
  light: string;
  dark: string;
}

interface DocumentStyling {
  /**
   * Background styling for the outer document area.
   * Supports CSS background values including gradients.
   * Example: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
   */
  background?: string | ThemeVariantValue;

  /**
   * Background color for the editor canvas/content area.
   * Should be a solid color value.
   * Example: "#ffffff" or "rgb(255, 255, 255)"
   */
  canvasBackground?: string | ThemeVariantValue;

  /**
   * Text color for the editor content.
   * Example: "#333333" or "rgb(51, 51, 51)"
   */
  textColor?: string | ThemeVariantValue;

  /**
   * Font family for the editor content.
   * Example: "Inter, sans-serif" or "'Times New Roman', serif"
   */
  fontFamily?: string;
}
```

### Usage Example

```tsx
<DdocEditor
  documentStyling={{
    background: {
      light: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      dark: 'linear-gradient(135deg, #2a3145 0%, #3a2f59 100%)',
    },
    canvasBackground: { light: '#ffffff', dark: '#1e1f22' },
    textColor: { light: '#333333', dark: '#e8ebec' },
    fontFamily: 'Inter, sans-serif',
  }}
  // ... other props
/>
```

**Note:** Document styling works in both regular editor mode and presentation mode. In presentation mode, only `canvasBackground`, `textColor`, and `fontFamily` are applied to maintain clean slide appearance.

## Custom Fonts

The editor ships with a **system-font baseline only** (Arial, Calibri, Georgia, Times New Roman, etc.) and makes **no third-party font requests** — there is no Google Fonts `@import`. To offer additional fonts, pass a `fonts` catalog. Each font is self-hosted by your app and loaded **on demand** via the CSS Font Loading API: a font's `woff2` is fetched only when it's selected in the picker or when a document (including a remote collaborator's change) actually renders text in it.

```typescript
type FontDescriptor = {
  /** Display name shown in the picker, e.g. "Poppins". */
  name: string;
  /** CSS font-family stack stored in the content, e.g. "Poppins, sans-serif". */
  family: string;
  /**
   * woff2 source(s). Omit for a pure system font (no loading).
   *   - string: a single file covering all weights (e.g. a variable font).
   *   - Record<number, string>: a per-weight map, e.g. { 400: url400, 700: url700 }.
   */
  url?: string | Record<number, string>;
  /**
   * Optional SVG preview rendered in the picker. Any React node that renders an
   * <svg>. Falls back to the font name in the default font when absent.
   */
  preview?: React.ReactNode;
};
```

### Usage Example

```tsx
import { DdocEditor, FontDescriptor } from '@fileverse-dev/ddoc';
// Self-host the woff2 files however your bundler prefers (e.g. @fontsource/*).
import poppins400 from '@fontsource/poppins/files/poppins-latin-400-normal.woff2';
import poppins700 from '@fontsource/poppins/files/poppins-latin-700-normal.woff2';

const fonts: FontDescriptor[] = [
  {
    name: 'Poppins',
    family: 'Poppins, sans-serif',
    url: { 400: poppins400, 700: poppins700 },
    preview: <PoppinsPreview />, // optional SVG
  },
];

<DdocEditor fonts={fonts} /* ...other props */ />;
```

**Notes:**

- The picker lists the system baseline and your catalog **together, sorted A–Z** (with **Default** pinned to the top).
- The CSS face name is derived from the first token of `family`, so `name` is purely cosmetic and can differ (e.g. `name: 'Poppins (Brand)'`, `family: 'Poppins, sans-serif'`).
- The catalog also drives PDF/print export, which emits `@font-face` rules for the registered fonts.
- Host your `woff2` files **same-origin** so they resolve in both the editor and the print iframe.

## Comments & Collaboration Props

| Property               | Type                                    | Description                        |
| ---------------------- | --------------------------------------- | ---------------------------------- |
| `initialComments`      | `IComment[]`                            | Initial comments to display        |
| `setInitialComments`   | `(comments: IComment[]) => void`        | Function to update comments        |
| `onCommentReply`       | `(id: string, reply: IComment) => void` | Callback for comment replies       |
| `onNewComment`         | `(comment: IComment) => void`           | Callback for new comments          |
| `commentDrawerOpen`    | `boolean`                               | Controls comment drawer visibility |
| `onCommentDrawerOpenChange` | `(open: boolean) => void`          | Comment drawer opened or closed    |
| `setCommentDrawerOpen` | `(isOpen: boolean) => void`             | Deprecated, use `onCommentDrawerOpenChange` |
| `onResolveComment`     | `(commentId: string) => void`           | Callback when resolving comments   |
| `onUnresolveComment`   | `(commentId: string) => void`           | Callback when unresolving comments |
| `onDeleteComment`      | `(commentId: string) => void`           | Callback when deleting comments    |
| `disableInlineComment` | `boolean`                               | Disables inline commenting feature |

## Authentication Props

| Property             | Type                                  | Description                         |
| -------------------- | ------------------------------------- | ----------------------------------- |
| `isConnected`        | `boolean`                             | User connection status              |
| `isLoading`          | `boolean`                             | Authentication loading state        |
| `connectViaUsername` | `(username: string) => Promise<void>` | Username-based authentication       |
| `connectViaWallet`   | `() => Promise<void>`                 | Wallet-based authentication         |
| `isDDocOwner`        | `boolean`                             | Indicates if user owns the document |

## Utility Props

| Property            | Type                                                                     | Description                               |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `setCharacterCount` | `React.Dispatch<SetStateAction<number>>`                                 | Deprecated, use `onStatsChange`. Updates character count |
| `setWordCount`      | `React.Dispatch<SetStateAction<number>>`                                 | Deprecated, use `onStatsChange`. Updates word count |
| `setPageCount`      | `React.Dispatch<SetStateAction<number>>`                                 | Deprecated, use `onStatsChange`. Updates approx. export page count |
| `ensResolutionUrl`  | `string`                                                                 | URL for ENS name resolution               |
| `ipfsImageUploadFn` | ` (file: File) => Promise<IpfsImageUploadResponse>`                      | function for secure image uploads         |
| `ipfsImageFetchFn`  | ` (_data: IpfsImageFetchPayload) => Promise<{ url: string;file: File;}>` | function for fetch secure image from IPFS |
| `onError`           | `(error: string) => void`                                                | General error handler                     |
| `onInlineComment`   | `() => void`                                                             | Callback for inline comments              |
| `onMarkdownExport`  | `() => void`                                                             | Callback for markdown export              |
| `onMarkdownImport`  | `() => void`                                                             | Callback for markdown import              |
| `onPdfExport`       | `() => void`                                                             | Callback for pdf export                   |
| `onSlidesShare`     | `() => void`                                                             | Callback for slides sharing               |
| `onComment`         | `() => void`                                                             | General comment callback                  |

## Steps to run this example locally

- `npm i`
- `npm run dev`

It will open up a vite server, that will have the Ddoc Editor.

⚠️ This repository is currently undergoing rapid development, with frequent updates and changes. We recommend not to use in production yet.
