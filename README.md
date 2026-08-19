# dDocs Editor
[ddocs.new](http://ddocs.new/) is your privacy-focused, open-source alternative to Google Docs that is as feature-complete and fast. It is an end-to-end encrypted and sovereign document editor for multiplayer collaboration 💛


dDocs enables secure, real-time and asynchronous collaboration without compromising user privacy.


## 𓆣 Features:
- End-to-end encryption
- Markdown and LaTeX support
- Dark mode and color themes
- Offline/online editing (continue writing and opening older docs even with no WiFi)
- Suggestion mode and commenting
- Cross-device sync (desktop and mobile)
- Zero-knowledge powered granular permissions and social recovery
- Version history
- MermaidJS diagram support
- End-to-end encrypted, programmable API optimised for agents (opt-in)

<img width="2308" height="1458" alt="image" src="https://github.com/user-attachments/assets/32875e2e-b30b-431b-bbb6-74ce96f21141" />

This repository contains:

- `/package` – The core package code.
- Example & demo source code to showcase dDocs functionalities.

## Usage

### Prequisites

To use dDocs, ensure your project is set up with Tailwind CSS and have a Tailwind configuration file.

### Install & import

Add the following imports :

```javascript
import { DdocEditor } from '@fileverse-dev/ddoc';
import '@fileverse-dev/ddoc/styles'; // in App.jsx/App.tsx
```

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
| `@fileverse/ui`      | `>=5.0.0`   |
| `@fileverse/crypto`  | `>=0.0.21`  |
| `viem`               | `>=2.13.8`  |
| `framer-motion`      | `>=11.2.10` |
| `frimousse`          | `>=0.3.0`   |

These are externalized from the bundle to avoid duplication when your app already uses them. If you don't have them installed, npm (v7+) will auto-install them for you.

### Update Tailwind Config

In your tailwind config, add this line to content array :

`@fileverse-dev/ddoc/dist/index.es.js`

You should now be set to use dDocs!

# dDocProps Interface

The `DdocProps` interface is a TypeScript interface that defines the properties for a page-related component. It includes properties for handling preview mode, managing publishing data, and optionally storing metadata and content associated with the page.

## Core Props

| Property                 | Type                                          | Description                                     |
| ------------------------ | --------------------------------------------- | ----------------------------------------------- |
| `initialContent`         | `JSONContent`                                 | Initial content of the editor                   |
| `onChange`               | `(changes: JSONContent, chunk?: any) => void` | Callback triggered on editor content changes    |
| `ref`                    | `React.RefObject`                             | Reference to access editor instance             |
| `isPreviewMode`          | `boolean`                                     | Controls if editor is in preview/read-only mode |
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

| Property                | Type                                      | Description                            |
| ----------------------- | ----------------------------------------- | -------------------------------------- |
| `zoomLevel`             | `string`                                  | Current zoom level of the editor       |
| `setZoomLevel`          | `React.Dispatch<SetStateAction<string>>`  | Function to update zoom level          |
| `isNavbarVisible`       | `boolean`                                 | Controls navbar visibility             |
| `setIsNavbarVisible`    | `React.Dispatch<SetStateAction<boolean>>` | Function to toggle navbar visibility   |
| `renderNavbar`          | `() => JSX.Element`                       | Custom navbar renderer                 |
| `renderThemeToggle`     | `() => JSX.Element`                       | Custom theme toggle renderer           |
| `isPresentationMode`    | `boolean`                                 | Controls presentation mode             |
| `setIsPresentationMode` | `React.Dispatch<SetStateAction<boolean>>` | Function to toggle presentation mode   |
| `sharedSlidesLink`      | `string`                                  | Link for shared presentation slides    |
| `documentStyling`       | `DocumentStyling`                         | Custom styling for document appearance |
| `fonts`                 | `FontDescriptor[]`                        | Consumer-provided font catalog (see Custom Fonts) |

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
| `setCommentDrawerOpen` | `(isOpen: boolean) => void`             | Function to toggle comment drawer  |
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
| `setCharacterCount` | `React.Dispatch<SetStateAction<number>>`                                 | Updates character count                   |
| `setWordCount`      | `React.Dispatch<SetStateAction<number>>`                                 | Updates word count                        |
| `setPageCount`      | `React.Dispatch<SetStateAction<number>>`                                 | Updates approx. export page count         |
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

## AI Writer Props

| Property           | Type          | Description                                     |
| ------------------ | ------------- | ----------------------------------------------- |
| `activeModel`      | `CustomModel` | Currently selected AI model for text generation |
| `maxTokens`        | `number`      | Maximum token limit for AI-generated content    |
| `isAIAgentEnabled` | `boolean`     | Toggle for AI agent functionality               |

### Steps to run this example locally

- `npm i`
- `npm run dev`

It will open up a vite server, that will have the Ddoc Editor.

⚠️ This repository is currently undergoing rapid development, with frequent updates and changes. We recommend not to use in production yet.
