import { describe, it, expect, afterEach } from 'vitest';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { handleMarkdownContent, isMarkdown } from '../mardown-paste-handler';
import { readDocxSpacingFromArchive } from './docx-spacing';

/**
 * TEC-2677: an imported doc had "most of the text" subscripted because the
 * author uses tildes in dialogue. DOCX import hands HTML to
 * handleMarkdownContent, which then rewrote markdown shorthand over it — so
 * `~x~` became <sub>, `^x^` became <sup>, and `4*6` became a literal `4\*6`.
 */

const run = (text: string, rPr = '') =>
  `<w:r>${
    rPr ? `<w:rPr>${rPr}</w:rPr>` : ''
  }<w:t xml:space="preserve">${text}</w:t></w:r>`;

const para = (...runs: string[]) =>
  `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${runs.join('')}</w:p>`;

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

const makeEditor = () => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion: 2 }) as AnyExtension[],
    textDirection: 'auto',
  });
  mounted.push(editor);
  return editor;
};

/** Exactly what docx-import.tsx does, minus the file input. */
const importDocx = async (editor: Editor, arrayBuffer: ArrayBuffer) => {
  const { value: extractedHtml } = await mammoth.convertToHtml(
    { buffer: Buffer.from(arrayBuffer) },
    { ignoreEmptyParagraphs: false },
  );
  const spacedHtml = await readDocxSpacingFromArchive(
    arrayBuffer,
    extractedHtml,
  );
  await handleMarkdownContent(editor.view, spacedHtml, undefined, {
    preserveEmptyParagraphs: true,
    preserveLiteralText: true,
  });
};

const text = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'paragraph' && node.textContent) {
      out.push(node.textContent);
    }
  });
  return out.join('\n');
};

const marks = (editor: Editor) => {
  const names = new Set<string>();
  editor.state.doc.descendants((node) => {
    node.marks.forEach((mark) => names.add(mark.type.name));
  });
  return names;
};

describe('DOCX import preserves literal text', () => {
  it('keeps tildes in dialogue as text, not subscript', async () => {
    const line = '"~I missed you~," she said.';
    const editor = makeEditor();

    await importDocx(editor, await buildDocx(para(run(line))));

    expect(text(editor)).toBe(line);
    expect(marks(editor).has('subscript')).toBe(false);
  });

  it('keeps a caret as text, not superscript', async () => {
    const line = 'Reference x^2^ in the prose.';
    const editor = makeEditor();

    await importDocx(editor, await buildDocx(para(run(line))));

    expect(text(editor)).toBe(line);
    expect(marks(editor).has('superscript')).toBe(false);
  });

  it('does not leak a markdown escape into digit*digit text', async () => {
    const line = 'Cost is 4*6 dollars.';
    const editor = makeEditor();

    await importDocx(editor, await buildDocx(para(run(line))));

    expect(text(editor)).toBe(line);
    expect(text(editor)).not.toContain('\\');
  });

  // The shorthand is what goes away, not the formatting. A run Word really
  // marked as subscript still has to import as subscript.
  it('still honours subscript that the DOCX itself declares', async () => {
    const editor = makeEditor();

    await importDocx(
      editor,
      await buildDocx(
        para(run('H'), run('2', '<w:vertAlign w:val="subscript"/>'), run('O')),
      ),
    );

    expect(text(editor)).toBe('H2O');
    expect(marks(editor).has('subscript')).toBe(true);
  });
});

describe('markdown tilde shorthand', () => {
  it('leaves a single-tilde span as literal text', async () => {
    const editor = makeEditor();

    await handleMarkdownContent(editor.view, '~I missed you~', undefined);

    expect(text(editor)).toBe('~I missed you~');
    expect(marks(editor).has('subscript')).toBe(false);
  });

  it('still strikes through a double-tilde span', async () => {
    const editor = makeEditor();

    await handleMarkdownContent(editor.view, '~~struck out~~', undefined);

    expect(text(editor)).toBe('struck out');
    expect(marks(editor).has('strike')).toBe(true);
  });

  // Superscript shorthand is untouched for markdown; only DOCX opts out.
  it('still raises a caret span in markdown', async () => {
    const editor = makeEditor();

    await handleMarkdownContent(editor.view, 'x^2^', undefined);

    expect(marks(editor).has('superscript')).toBe(true);
  });
});

/**
 * The sniffer decides whether a paste is markdown at all. The tests above call
 * handleMarkdownContent directly, so they cannot see a paste that never gets
 * that far — which is how removing the tilde clause silently cost strikethrough
 * its only signal in the whole OR-chain.
 */
describe('isMarkdown', () => {
  it('still recognises a paste whose only signal is a double tilde', () => {
    expect(isMarkdown('~~struck out~~')).toBe(true);
  });

  it('does not treat a lone single-tilde span as markdown', () => {
    expect(isMarkdown('~I missed you~')).toBe(false);
  });

  it('leaves the other signals alone', () => {
    expect(isMarkdown('# heading')).toBe(true);
    expect(isMarkdown('**bold**')).toBe(true);
    expect(isMarkdown('x^2^')).toBe(true);
    expect(isMarkdown('just some prose')).toBe(false);
  });
});
