# DOCX Import Parity (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 1 of DOCX import parity with Google Docs (TEC-2840), bringing robust support for Underline, 16 Highlight Colors, Paragraph Text Alignment (`w:jc`), and Image Alignment (`data-align`).

**Architecture:** 
1. Use Mammoth's `styleMap` configuration to emit `<u>` and `<mark data-color="#HEX">` tags directly during HTML conversion.
2. Extend the OOXML paragraph pass in `docx-spacing.ts` to parse `w:jc` (with style cascade inheritance) and image presence, applying `style="text-align: ..."` to blocks and `data-align="start|center|right"` to `<img>` elements.
3. Update `resizable-media.ts` `parseHTML` rule for `tag: 'img'` so TipTap preserves `data-align` on bare images.

**Tech Stack:** TypeScript, Mammoth.js, JSZip, TipTap / ProseMirror v3, Vitest

## Global Constraints

- Never break existing spacing attributes (`marginTop`, `marginBottom`, `lineHeight`) or blank line preservation (`preserveEmptyParagraphs: true`).
- If paragraph text diverges between HTML and OOXML, leave the HTML untouched (graceful fallback).
- Adhere to the existing test design in `package/extensions/docx/docx-spacing.test.ts` using mock XML documents and JSZip fixtures.

---

### Task 1: Mammoth Style Mapping for Underline & Highlight Colors

**Files:**
- Modify: `package/extensions/docx/docx-import.tsx:84-101`
- Create: `package/extensions/docx/docx-style-map.test.ts`

**Interfaces:**
- Produces: `DOCX_STYLE_MAP` string array exported from `docx-import.tsx` (or a helper constant) containing style mappings for `u` and all 16 OOXML highlight colors.

- [ ] **Step 1: Write the failing unit test for Mammoth style mapping**

Create `package/extensions/docx/docx-style-map.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import mammoth from 'mammoth';
import { DOCX_STYLE_MAP } from './docx-import';

describe('DOCX_STYLE_MAP', () => {
  it('contains rule for underline', () => {
    expect(DOCX_STYLE_MAP).toContain('u => u');
  });

  it('contains rules for all 16 OOXML highlight colors mapped to hex', () => {
    const expectedColors = [
      "highlight[color='yellow'] => mark[data-color='#FFFF00']",
      "highlight[color='green'] => mark[data-color='#00FF00']",
      "highlight[color='cyan'] => mark[data-color='#00FFFF']",
      "highlight[color='magenta'] => mark[data-color='#FF00FF']",
      "highlight[color='red'] => mark[data-color='#FF0000']",
      "highlight[color='blue'] => mark[data-color='#0000FF']",
      "highlight[color='darkBlue'] => mark[data-color='#00008B']",
      "highlight[color='darkCyan'] => mark[data-color='#008B8B']",
      "highlight[color='darkGreen'] => mark[data-color='#006400']",
      "highlight[color='darkMagenta'] => mark[data-color='#8B008B']",
      "highlight[color='darkRed'] => mark[data-color='#8B0000']",
      "highlight[color='darkYellow'] => mark[data-color='#808000']",
      "highlight[color='darkGray'] => mark[data-color='#A9A9A9']",
      "highlight[color='lightGray'] => mark[data-color='#D3D3D3']",
      "highlight[color='black'] => mark[data-color='#000000']",
      'highlight => mark',
    ];

    for (const rule of expectedColors) {
      expect(DOCX_STYLE_MAP).toContain(rule);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test package/extensions/docx/docx-style-map.test.ts`  
Expected: FAIL with "DOCX_STYLE_MAP is not exported from './docx-import'"

- [ ] **Step 3: Implement `DOCX_STYLE_MAP` and pass to `mammoth.convertToHtml`**

In `package/extensions/docx/docx-import.tsx`:
```typescript
export const DOCX_STYLE_MAP = [
  'u => u',
  "highlight[color='yellow'] => mark[data-color='#FFFF00']",
  "highlight[color='green'] => mark[data-color='#00FF00']",
  "highlight[color='cyan'] => mark[data-color='#00FFFF']",
  "highlight[color='magenta'] => mark[data-color='#FF00FF']",
  "highlight[color='red'] => mark[data-color='#FF0000']",
  "highlight[color='blue'] => mark[data-color='#0000FF']",
  "highlight[color='darkBlue'] => mark[data-color='#00008B']",
  "highlight[color='darkCyan'] => mark[data-color='#008B8B']",
  "highlight[color='darkGreen'] => mark[data-color='#006400']",
  "highlight[color='darkMagenta'] => mark[data-color='#8B008B']",
  "highlight[color='darkRed'] => mark[data-color='#8B0000']",
  "highlight[color='darkYellow'] => mark[data-color='#808000']",
  "highlight[color='darkGray'] => mark[data-color='#A9A9A9']",
  "highlight[color='lightGray'] => mark[data-color='#D3D3D3']",
  "highlight[color='black'] => mark[data-color='#000000']",
  'highlight => mark',
];
```

Pass `styleMap: DOCX_STYLE_MAP` inside `mammoth.convertToHtml({ arrayBuffer }, { styleMap: DOCX_STYLE_MAP, ignoreEmptyParagraphs: false, ... })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test package/extensions/docx/docx-style-map.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package/extensions/docx/docx-import.tsx package/extensions/docx/docx-style-map.test.ts
git commit -m "feat(docx): configure mammoth styleMap for underline and highlight colors"
```

---

### Task 2: Parse Paragraph Text Alignment (`w:jc`) & Cascading Styles in `docx-spacing.ts`

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:12-168`
- Modify: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Extends: `DocxParagraphSpacing` with `textAlign: string | null` and `hasImage: boolean`.
- Modifies: `readDocxSpacing(documentXml: string, stylesXml: string): DocxParagraphSpacing[]` to resolve `textAlign` and detect images.

- [ ] **Step 1: Write failing unit tests for paragraph alignment extraction and inheritance**

In `package/extensions/docx/docx-spacing.test.ts`, add:
```typescript
describe('readDocxSpacing paragraph alignment', () => {
  it('reads direct w:jc alignment on paragraph', () => {
    const xml = doc(
      para({ alignment: 'center', text: 'centered' }) +
        para({ alignment: 'right', text: 'right-aligned' }) +
        para({ alignment: 'both', text: 'justified' }) +
        para({ text: 'default' }),
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result[0].textAlign).toBe('center');
    expect(result[1].textAlign).toBe('right');
    expect(result[2].textAlign).toBe('justify');
    expect(result[3].textAlign).toBeNull();
  });

  it('inherits alignment from paragraph style and basedOn chain', () => {
    const xml = doc(
      para({ style: 'CenteredStyle', text: 'styled' }) +
        para({ style: 'ChildStyle', text: 'inherited' }),
    );
    const sty = styles(
      `<w:style w:styleId="CenteredStyle"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>` +
        `<w:style w:styleId="BaseRight"><w:pPr><w:jc w:val="right"/></w:pPr></w:style>` +
        `<w:style w:styleId="ChildStyle"><w:basedOn w:val="BaseRight"/></w:style>`,
    );

    const result = readDocxSpacing(xml, sty);
    expect(result[0].textAlign).toBe('center');
    expect(result[1].textAlign).toBe('right');
  });

  it('lets direct w:jc win over style alignment', () => {
    const xml = doc(
      para({ style: 'CenteredStyle', alignment: 'right', text: 'override' }),
    );
    const sty = styles(
      `<w:style w:styleId="CenteredStyle"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>`,
    );

    const result = readDocxSpacing(xml, sty);
    expect(result[0].textAlign).toBe('right');
  });

  it('detects images in paragraph', () => {
    const xml = doc(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>` +
        para({ text: 'no image' }),
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result[0].hasImage).toBe(true);
    expect(result[0].textAlign).toBe('center');
    expect(result[1].hasImage).toBe(false);
  });
});
```
Update helper `para` in `docx-spacing.test.ts` to accept optional `alignment?: string`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test package/extensions/docx/docx-spacing.test.ts`  
Expected: FAIL with missing `textAlign` / `hasImage` properties on `DocxParagraphSpacing`.

- [ ] **Step 3: Implement alignment parsing and inheritance in `docx-spacing.ts`**

In `package/extensions/docx/docx-spacing.ts`:
1. Update `DocxParagraphSpacing`:
```typescript
export type DocxParagraphSpacing = {
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineHeight: string | null;
  textAlign: string | null;
  hasImage: boolean;
  text: string;
};
```
2. Update `RawSpacing`:
```typescript
type RawSpacing = {
  before?: string;
  after?: string;
  line?: string;
  lineRule?: string;
  jc?: string;
};
```
3. Update `readSpacingElement`:
```typescript
const readSpacingElement = (pPr: Element | null | undefined): RawSpacing => {
  const spacing = pPr?.getElementsByTagName('w:spacing')[0];
  const jc = pPr?.getElementsByTagName('w:jc')[0]?.getAttribute('w:val') ?? undefined;

  const attr = (name: string) => {
    const value = spacing?.getAttribute(`w:${name}`);
    return value === null ? undefined : value;
  };
  return {
    before: attr('before'),
    after: attr('after'),
    line: attr('line'),
    lineRule: attr('lineRule'),
    jc,
  };
};
```
4. Update `mergeSpacing` to include `'jc'`:
```typescript
(['before', 'after', 'line', 'lineRule', 'jc'] as const).forEach((key) => {
  if (layer[key] !== undefined) next[key] = layer[key];
});
```
5. Add `normalizeAlignment`:
```typescript
const normalizeAlignment = (val?: string): string | null => {
  if (!val) return null;
  switch (val.toLowerCase()) {
    case 'left':
    case 'start':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'both':
    case 'distribute':
      return 'justify';
    default:
      return null;
  }
};
```
6. In `readDocxSpacing`, detect images and return `textAlign`:
```typescript
const hasImage =
  paragraph.getElementsByTagName('w:drawing').length > 0 ||
  paragraph.getElementsByTagName('w:pict').length > 0 ||
  paragraph.getElementsByTagName('v:imagedata').length > 0;

return {
  spaceBefore: toPt(raw.before),
  spaceAfter: toPt(raw.after),
  lineHeight: toLineHeight(raw),
  textAlign: normalizeAlignment(raw.jc),
  hasImage,
  text: paragraphText(paragraph),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test package/extensions/docx/docx-spacing.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package/extensions/docx/docx-spacing.ts package/extensions/docx/docx-spacing.test.ts
git commit -m "feat(docx): parse paragraph alignment and image detection from OOXML"
```

---

### Task 3: Apply Alignment & Image Alignment in `applyDocxSpacingToHtml`

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:185-209`
- Modify: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Modifies: `applyDocxSpacingToHtml(html: string, spacings: DocxParagraphSpacing[]): string` to stamp `style.textAlign` on blocks and `data-align`/`dataalign` on `<img>` elements.

- [ ] **Step 1: Write failing unit tests for HTML alignment and image alignment injection**

In `package/extensions/docx/docx-spacing.test.ts`, add:
```typescript
describe('applyDocxSpacingToHtml alignment & image', () => {
  it('applies text-align to paragraph and heading elements', () => {
    const html = '<p>center me</p><h1>right me</h1>';
    const spacings: DocxParagraphSpacing[] = [
      { spaceBefore: null, spaceAfter: null, lineHeight: null, textAlign: 'center', hasImage: false, text: 'center me' },
      { spaceBefore: null, spaceAfter: null, lineHeight: null, textAlign: 'right', hasImage: false, text: 'right me' },
    ];

    const result = applyDocxSpacingToHtml(html, spacings);
    expect(result).toBe('<p style="text-align: center;">center me</p><h1 style="text-align: right;">right me</h1>');
  });

  it('sets data-align and dataalign on img inside aligned paragraph', () => {
    const html = '<p><img src="test.png"></p>';
    const spacings: DocxParagraphSpacing[] = [
      { spaceBefore: null, spaceAfter: null, lineHeight: null, textAlign: 'right', hasImage: true, text: '' },
    ];

    const result = applyDocxSpacingToHtml(html, spacings);
    expect(result).toContain('data-align="right"');
    expect(result).toContain('dataalign="right"');
  });

  it('defaults image data-align to start when alignment is left', () => {
    const html = '<p><img src="test.png"></p>';
    const spacings: DocxParagraphSpacing[] = [
      { spaceBefore: null, spaceAfter: null, lineHeight: null, textAlign: 'left', hasImage: true, text: '' },
    ];

    const result = applyDocxSpacingToHtml(html, spacings);
    expect(result).toContain('data-align="start"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test package/extensions/docx/docx-spacing.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement alignment and image stamping in `applyDocxSpacingToHtml`**

In `package/extensions/docx/docx-spacing.ts`:
```typescript
blocks.forEach((block, index) => {
  const { spaceBefore, spaceAfter, lineHeight, textAlign, hasImage } = spacings[index];
  const element = block as HTMLElement;
  if (spaceBefore !== null) element.style.marginTop = `${spaceBefore}pt`;
  if (spaceAfter !== null) element.style.marginBottom = `${spaceAfter}pt`;
  if (lineHeight !== null) element.style.lineHeight = lineHeight;
  if (textAlign !== null) element.style.textAlign = textAlign;

  if (hasImage || element.querySelector('img')) {
    const img = element.querySelector('img');
    if (img) {
      const align =
        textAlign === 'center'
          ? 'center'
          : textAlign === 'right'
            ? 'right'
            : 'start';
      img.setAttribute('data-align', align);
      img.setAttribute('dataalign', align);
    }
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test package/extensions/docx/docx-spacing.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package/extensions/docx/docx-spacing.ts package/extensions/docx/docx-spacing.test.ts
git commit -m "feat(docx): stamp text-align and image data-align in applyDocxSpacingToHtml"
```

---

### Task 4: Enhance `resizable-media.ts` to Parse `data-align` on Bare `<img>` Tags

**Files:**
- Modify: `package/extensions/resizable-media/resizable-media.ts:240-248`
- Create: `package/extensions/resizable-media/resizable-media-parse.test.ts`

**Interfaces:**
- Modifies: `ResizableMedia` extension `parseHTML` for `tag: 'img'` to parse `dataAlign`.

- [ ] **Step 1: Write failing unit test for `tag: 'img'` `dataAlign` parsing in `resizable-media`**

Create `package/extensions/resizable-media/resizable-media-parse.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { ResizableMedia } from './resizable-media';
import { Editor } from '@tiptap/core';

describe('ResizableMedia parseHTML tag: img', () => {
  it('parses data-align from bare img element', () => {
    const editor = new Editor({
      extensions: [ResizableMedia],
      content: '<img src="https://example.com/pic.png" data-align="right" />',
    });

    const mediaNode = editor.state.doc.firstChild;
    expect(mediaNode?.type.name).toBe('resizableMedia');
    expect(mediaNode?.attrs.dataAlign).toBe('right');
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test package/extensions/resizable-media/resizable-media-parse.test.ts`  
Expected: FAIL (mediaNode.attrs.dataAlign is 'center' instead of 'right')

- [ ] **Step 3: Update `tag: 'img'` rule in `resizable-media.ts`**

In `package/extensions/resizable-media/resizable-media.ts` line 241:
```typescript
      {
        tag: 'img',
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          const align =
            img.getAttribute('data-align') ||
            img.getAttribute('dataalign');
          return {
            src: img.getAttribute('src'),
            'media-type': 'img',
            ...(align ? { dataAlign: align } : {}),
            backgroundColor: readBackgroundColor(img),
          };
        },
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test package/extensions/resizable-media/resizable-media-parse.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package/extensions/resizable-media/resizable-media.ts package/extensions/resizable-media/resizable-media-parse.test.ts
git commit -m "feat(resizable-media): parse data-align on bare img elements"
```

---

### Task 5: Full End-to-End DOCX Archive Verification

**Files:**
- Create: `package/extensions/docx/docx-import-parity.test.ts`

**Interfaces:**
- Tests: End-to-end flow from `.docx` ZIP archive creation through `readDocxSpacingFromArchive` and simulated Mammoth output.

- [ ] **Step 1: Write comprehensive integration test**

Create `package/extensions/docx/docx-import-parity.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readDocxSpacingFromArchive } from './docx-spacing';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const createDocxArchive = async (documentXml: string, stylesXml?: string): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  if (stylesXml) {
    zip.file('word/styles.xml', stylesXml);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
};

describe('DOCX Import Parity End-to-End', () => {
  it('zips paragraph margins, lineHeight, alignment, and image data-align together', async () => {
    const documentXml = `<?xml version="1.0"?>
      <w:document xmlns:w="${W}">
        <w:body>
          <w:p>
            <w:pPr>
              <w:spacing w:before="240" w:after="480" w:line="240" w:lineRule="auto"/>
              <w:jc w:val="center"/>
            </w:pPr>
            <w:r><w:t>Centered title</w:t></w:r>
          </w:p>
          <w:p>
            <w:pPr>
              <w:jc w:val="right"/>
            </w:pPr>
            <w:r><w:drawing><wp:inline/></w:drawing></w:r>
          </w:p>
        </w:body>
      </w:document>`;

    const arrayBuffer = await createDocxArchive(documentXml);

    // Mammoth output with underline & highlight
    const mammothHtml =
      '<p><u>Centered</u> <mark data-color="#FFFF00">title</mark></p><p><img src="data:image/png;base64,123" /></p>';

    const finalHtml = await readDocxSpacingFromArchive(arrayBuffer, mammothHtml);

    expect(finalHtml).toContain('style="margin-top: 12pt; margin-bottom: 24pt; line-height: 120%; text-align: center;"');
    expect(finalHtml).toContain('<u>Centered</u>');
    expect(finalHtml).toContain('<mark data-color="#FFFF00">title</mark>');
    expect(finalHtml).toContain('data-align="right"');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test package/extensions/docx/docx-import-parity.test.ts`  
Expected: PASS

- [ ] **Step 3: Run entire test suite to ensure zero regressions**

Run: `npm test`  
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add package/extensions/docx/docx-import-parity.test.ts
git commit -m "test(docx): add end-to-end integration test for docx import parity"
```
