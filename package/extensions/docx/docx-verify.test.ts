import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { readDocxSpacing, applyDocxSpacingToHtml } from './docx-spacing';
import { DOCX_STYLE_MAP } from './docx-import';

const FIXTURES = path.join(__dirname, '__fixtures__');

/** The real import pipeline, minus the editor insertion. */
const importDocx = async (file: string) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, file));
  const zip = await JSZip.loadAsync(buffer);
  const spacings = readDocxSpacing(
    await zip.file('word/document.xml')!.async('string'),
    (await zip.file('word/styles.xml')?.async('string')) ??
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
  );
  const { value: html } = await mammoth.convertToHtml({ buffer } as never, {
    styleMap: DOCX_STYLE_MAP,
    ignoreEmptyParagraphs: false,
  });
  return { html, spacings, result: applyDocxSpacingToHtml(html, spacings) };
};

const count = (haystack: string, needle: RegExp) =>
  (haystack.match(needle) || []).length;

describe('docx import against real Google Docs exports', () => {
  it('restores run formatting in a plainly formatted export', async () => {
    const { result } = await importDocx('gdocs-manual-formatting.docx');
    expect(count(result, /font-family:/g)).toBe(16);
    expect(count(result, /font-size:/g)).toBe(5);
  });

  it('restores run formatting despite footnotes and nested lists', async () => {
    // This file bailed both gates before the matcher was hardened: 71 blocks
    // against 67 w:p (footnote li + nested p), and nested list items whose
    // textContent swallowed their children.
    const { result } = await importDocx('gdocs-footnotes-lists.docx');
    expect(count(result, /font-family:/g)).toBeGreaterThan(0);
    expect(count(result, /font-size:/g)).toBeGreaterThan(0);
  });

  it('emits no black or white text that would vanish in one theme', async () => {
    const { result } = await importDocx('gdocs-footnotes-lists.docx');
    expect(result).not.toContain('color: rgb(0, 0, 0)');
    expect(result).not.toContain('color: rgb(255, 255, 255)');
  });

  it('stamps explicit spacing on every matched block', async () => {
    const { result, spacings } = await importDocx('gdocs-footnotes-lists.docx');
    // No paragraph may fall through to editor.css's default gap (TEC-2900).
    expect(count(result, /margin-bottom:/g)).toBe(spacings.length);
  });

  it('emits font sizes in px so the size stepper stays coherent', async () => {
    const { result } = await importDocx('gdocs-manual-formatting.docx');
    expect(result).not.toMatch(/font-size: [\d.]+pt/);
  });
});
