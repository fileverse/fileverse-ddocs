import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  starPasteRegex as upstreamStarPasteRegex,
  underscorePasteRegex as upstreamUnderscorePasteRegex,
} from '@tiptap/extension-italic';
import { starPasteRegex as upstreamBoldStarPasteRegex } from '@tiptap/extension-bold';
import {
  CommonMarkBold,
  CommonMarkItalic,
  boldStarInputRegex,
  boldStarPasteRegex,
  boldUnderscorePasteRegex,
  italicStarInputRegex,
  italicStarPasteRegex,
  italicUnderscorePasteRegex,
} from './commonmark-emphasis';

const matchAll = (re: RegExp, text: string) => {
  const fresh = new RegExp(
    re.source,
    re.flags.includes('g') ? re.flags : re.flags + 'g',
  );
  return [...text.matchAll(fresh)].map((m) => m[m.length - 1]);
};

describe('CommonMark boundary regexes', () => {
  it('still matches tight emphasis', () => {
    expect(matchAll(italicStarPasteRegex, 'an *important* word')).toEqual([
      'important',
    ]);
    expect(matchAll(italicStarPasteRegex, '*multi word phrase*')).toEqual([
      'multi word phrase',
    ]);
    expect(matchAll(italicStarPasteRegex, '*x*')).toEqual(['x']);
    expect(matchAll(boldStarPasteRegex, 'a **bold phrase** here')).toEqual([
      'bold phrase',
    ]);
    expect(
      matchAll(italicUnderscorePasteRegex, 'a _quiet aside_ here'),
    ).toEqual(['quiet aside']);
  });

  it('rejects delimiter-adjacent whitespace (the multiplication shapes)', () => {
    expect(matchAll(italicStarPasteRegex, 's * x_f * G')).toEqual([]);
    expect(matchAll(italicStarPasteRegex, '5 * 3 * 2')).toEqual([]);
    expect(matchAll(italicStarPasteRegex, '-999 * D * p')).toEqual([]);
    expect(matchAll(italicStarPasteRegex, 'k * (k-1) * M')).toEqual([]);
    expect(matchAll(italicStarPasteRegex, 'a *x * b')).toEqual([]);
    expect(matchAll(italicStarPasteRegex, 'a * x* b')).toEqual([]);
    expect(matchAll(boldStarPasteRegex, '2 ** 3 ** 4')).toEqual([]);
    expect(matchAll(italicUnderscorePasteRegex, 'x _ y _ z')).toEqual([]);
    expect(matchAll(boldUnderscorePasteRegex, 'a __ b __ c')).toEqual([]);
  });

  it('input regexes anchor to line end and keep content as the last capture group', () => {
    const m = 'see *word*'.match(italicStarInputRegex);
    expect(m).not.toBeNull();
    expect(m![m!.length - 1]).toBe('word');
    expect('see *word* then'.match(italicStarInputRegex)).toBeNull();
    const b = 'see **word**'.match(boldStarInputRegex);
    expect(b).not.toBeNull();
    expect(b![b!.length - 1]).toBe('word');
  });

  it('is strictly narrowing: everything we match, upstream matched too', () => {
    const samples = [
      'an *important* word',
      '*multi word phrase*',
      's * x_f * G',
      '5 * 3 * 2',
      'a *x * b',
      'a * x* b',
      '*x*',
      'edge *y*',
      'a _quiet aside_ here',
      'x _ y _ z',
      'a **bold phrase** here',
      '2 ** 3 ** 4',
    ];
    for (const s of samples) {
      const oursItalic = matchAll(italicStarPasteRegex, s);
      const upstreamItalic = matchAll(upstreamStarPasteRegex, s);
      for (const hit of oursItalic) {
        expect(upstreamItalic.map((u) => u.trim())).toContain(hit.trim());
      }
      const oursUnd = matchAll(italicUnderscorePasteRegex, s);
      const upstreamUnd = matchAll(upstreamUnderscorePasteRegex, s);
      for (const hit of oursUnd) {
        expect(upstreamUnd.map((u) => u.trim())).toContain(hit.trim());
      }
      const oursBold = matchAll(boldStarPasteRegex, s);
      const upstreamBold = matchAll(upstreamBoldStarPasteRegex, s);
      for (const hit of oursBold) {
        expect(upstreamBold.map((u) => u.trim())).toContain(hit.trim());
      }
    }
  });

  it('documents the upstream laxness we are removing (revert catcher)', () => {
    expect(matchAll(upstreamStarPasteRegex, 's * x_f * G')).not.toEqual([]);
    expect(matchAll(italicStarPasteRegex, 's * x_f * G')).toEqual([]);
  });

  it('stays fast on pathological input (timeout IS the signal)', () => {
    const pathological = (' *' + 'x'.repeat(12)).repeat(4000) + ' *';
    const start = performance.now();
    matchAll(italicStarPasteRegex, pathological);
    matchAll(boldStarPasteRegex, pathological);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

// jsdom has no ClipboardEvent/DataTransfer; prosemirror's pasteText constructs
// one. A bare Event with a clipboardData stub is enough for the paste path.
class FakeClipboardEvent extends Event {
  clipboardData = {
    getData: () => '',
    setData: () => undefined,
    types: [] as string[],
  };
}
(globalThis as Record<string, unknown>).ClipboardEvent = FakeClipboardEvent;

describe('editor wiring', () => {
  const makeEditor = () =>
    new Editor({
      element: document.createElement('div'),
      extensions: [
        StarterKit.configure({ italic: false, bold: false, link: false }),
        CommonMarkItalic,
        CommonMarkBold,
      ],
    });

  const marksIn = (editor: Editor) => {
    const found: string[] = [];
    editor.state.doc.descendants((node) => {
      node.marks.forEach((m) => found.push(m.type.name));
    });
    return found;
  };

  it('paste keeps spaced multiplication literal', () => {
    const editor = makeEditor();
    editor.view.pasteText('5 * 3 * 2 and s * x_f * G');
    expect(editor.state.doc.textContent).toBe('5 * 3 * 2 and s * x_f * G');
    expect(marksIn(editor)).toEqual([]);
    editor.destroy();
  });

  it('paste keeps spaced exponentiation-style bold shapes literal', () => {
    const editor = makeEditor();
    editor.view.pasteText('2 ** 3 ** 4');
    expect(editor.state.doc.textContent).toBe('2 ** 3 ** 4');
    expect(marksIn(editor)).toEqual([]);
    editor.destroy();
  });

  it('paste still converts tight emphasis', () => {
    const editor = makeEditor();
    editor.view.pasteText('an *important* word and a **bold** one');
    expect(marksIn(editor)).toContain('italic');
    expect(marksIn(editor)).toContain('bold');
    expect(editor.state.doc.textContent).toBe(
      'an important word and a bold one',
    );
    editor.destroy();
  });

  const type = (editor: Editor, text: string) => {
    for (const ch of text) {
      const handled = editor.view.someProp('handleTextInput', (f) =>
        f(
          editor.view,
          editor.state.selection.from,
          editor.state.selection.to,
          ch,
        ),
      );
      if (!handled) {
        editor.view.dispatch(editor.state.tr.insertText(ch));
      }
    }
  };

  it('typing spaced multiplication stays literal', () => {
    const editor = makeEditor();
    type(editor, '5 * 3 * 2 done');
    expect(editor.state.doc.textContent).toBe('5 * 3 * 2 done');
    expect(marksIn(editor)).toEqual([]);
    editor.destroy();
  });

  it('typing tight emphasis still italicizes', () => {
    const editor = makeEditor();
    type(editor, 'an *important* word');
    expect(marksIn(editor)).toContain('italic');
    expect(editor.state.doc.textContent).toBe('an important word');
    editor.destroy();
  });
});
