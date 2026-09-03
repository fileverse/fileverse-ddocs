import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import JSZip from 'jszip';
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';
import { useHeadlessEditor } from './use-headless-editor';

// Production passes mammoth's browser input ({ arrayBuffer }); the Node build
// resolved under vitest wants { buffer }. Only the input shape is bridged —
// the options the hook builds still reach the real converter.
vi.mock('mammoth', async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await vi.importActual('mammoth')) as any;
  const actual = mod.default ?? mod;
  return {
    default: {
      ...actual,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      convertToHtml: (input: any, options: any) =>
        actual.convertToHtml(
          input?.arrayBuffer
            ? { buffer: Buffer.from(input.arrayBuffer) }
            : input,
          options,
        ),
    },
  };
});

const buildDocx = (body: string) => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
};

const importDocx = async (body: string) => {
  const buffer = await buildDocx(body);
  const file = new File([buffer], 'fixture.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  // jsdom's File has no arrayBuffer() in this environment.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (file as any).arrayBuffer = async () => buffer;

  const { result } = renderHook(() => useHeadlessEditor());
  const blob = await result.current.getYjsContentFromDocx(
    file,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async () => ({}) as any,
  );
  const doc = new Y.Doc();
  Y.applyUpdate(doc, toUint8Array(blob as string));
  return doc.getXmlFragment('default').toString();
};

/**
 * TEC-2940: the homepage bulk upload (create-card drag-drop → md-bulk-upload
 * → getYjsContentFromDocx) is a second DOCX importer, and it ran none of the
 * TEC-2840 parity work — no style map, no empty paragraphs, no OOXML pass.
 */
describe('headless DOCX import (homepage bulk upload)', () => {
  it('stamps paragraph spacing and alignment', async () => {
    const xml = await importDocx(
      `<w:p><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:r><w:t>centred</w:t></w:r></w:p>`,
    );

    expect(xml).toContain('spaceAfter="12"');
    expect(xml).toContain('textAlign="center"');
  });

  it('carries run colour, font family and font size', async () => {
    const xml = await importDocx(
      `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/><w:rFonts w:ascii="Georgia"/><w:sz w:val="36"/></w:rPr><w:t>styled</w:t></w:r></w:p>`,
    );

    expect(xml).toContain('color="rgb(255, 0, 0)"');
    expect(xml).toContain('fontFamily="Georgia, serif"');
    expect(xml).toContain('fontSize="24px"');
  });

  it('carries highlight through the style map', async () => {
    const xml = await importDocx(
      `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>marked</w:t></w:r></w:p>`,
    );

    expect(xml).toContain('<highlight color="#FFFF00">marked</highlight>');
  });

  it('keeps a blank line the author typed', async () => {
    const p = (text?: string) =>
      `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${
        text ? `<w:r><w:t>${text}</w:t></w:r>` : ''
      }</w:p>`;

    const xml = await importDocx([p('first'), p(), p('second')].join(''));

    // Imported blocks are the ones carrying spacing; the editor's own initial
    // empty paragraph has none.
    expect(xml.match(/spaceAfter=/g) ?? []).toHaveLength(3);
  });
});
