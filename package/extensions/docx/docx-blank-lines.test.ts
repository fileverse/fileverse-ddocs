import { describe, it, expect, afterEach } from 'vitest';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { handleMarkdownContent } from '../mardown-paste-handler';
import { readDocxSpacingFromArchive } from './docx-spacing';

/**
 * TEC-2701 H3: "blank lines did not survive" a DOCX import.
 *
 * `ignoreEmptyParagraphs: false` keeps them through mammoth, and the spacing
 * pass needs them to line up 1:1 with the `w:p` elements — but
 * handleMarkdownContent then deleted every empty top-level <p>, undoing the
 * whole thing. The QA plan claimed they survived; they did not.
 */

const para = (text?: string) =>
  `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${
    text ? `<w:r><w:t>${text}</w:t></w:r>` : ''
  }</w:p>`;

/** The smallest archive mammoth will read. */
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
<w:body>${body}</w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: 'arraybuffer' });
};

const mounted: Editor[] = [];
afterEach(() => mounted.splice(0).forEach((editor) => editor.destroy()));

const makeEditor = (schemaVersion: number) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
    textDirection: 'auto',
  });
  mounted.push(editor);
  return editor;
};

/** Exactly what docx-import.tsx does, minus the file input. */
const importDocx = async (
  editor: Editor,
  arrayBuffer: ArrayBuffer,
  preserveEmptyParagraphs = true,
) => {
  // Production passes { arrayBuffer } (mammoth's browser entry); under Node
  // the same call wants a Buffer. The option under test is the same either way.
  const { value: extractedHtml } = await mammoth.convertToHtml(
    { buffer: Buffer.from(arrayBuffer) },
    { ignoreEmptyParagraphs: false },
  );
  const spacedHtml = await readDocxSpacingFromArchive(
    arrayBuffer,
    extractedHtml,
  );
  await handleMarkdownContent(editor.view, spacedHtml, undefined, {
    preserveEmptyParagraphs,
  });
};

/** Paragraph texts in order; a blank line reads as ''. */
const lines = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'paragraph') out.push(node.textContent);
  });
  // drop the editor's own leading/trailing empty blocks, which are not import
  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out;
};

describe.each([1, 2])('DOCX blank lines on schema v%i', (version) => {
  it('keeps a blank line the author typed between paragraphs', async () => {
    const buffer = await buildDocx(
      [para('first'), para(), para('second')].join(''),
    );
    const editor = makeEditor(version);

    await importDocx(editor, buffer);

    expect(lines(editor)).toEqual(['first', '', 'second']);
  });

  it('keeps a run of consecutive blank lines', async () => {
    const buffer = await buildDocx(
      [para('first'), para(), para(), para('second')].join(''),
    );
    const editor = makeEditor(version);

    await importDocx(editor, buffer);

    expect(lines(editor)).toEqual(['first', '', '', 'second']);
  });

  // The default is unchanged: markdown-it invents empty paragraphs nobody
  // typed, so every other caller still strips them. Guards against the fix
  // being widened into a behaviour change for markdown paste.
  it('still strips empty paragraphs when the caller does not opt in', async () => {
    const buffer = await buildDocx(
      [para('first'), para(), para('second')].join(''),
    );
    const editor = makeEditor(version);

    await importDocx(editor, buffer, false);

    expect(lines(editor)).toEqual(['first', 'second']);
  });
});
