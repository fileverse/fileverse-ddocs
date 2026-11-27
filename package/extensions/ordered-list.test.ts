import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import type { Editor } from '@tiptap/react';
import { destroyTracked, makeEditor, track } from './caret-marks/test-helpers';

// Our markdown paste handler decides plain-text pastes (TEC-2677), and a typed
// ordered list keeps `type: null` (rendered `1.`) unless `<ol type>` says so.

afterEach(destroyTracked);

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ClipboardEvent ??= Event;
});

const clipboardEvent = (html: string, text: string) =>
  Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
    clipboardData: {
      types: html ? ['text/html', 'text/plain'] : ['text/plain'],
      files: [],
      items: [],
      getData: (type: string) =>
        type === 'text/html' ? html : type === 'text/plain' ? text : '',
    },
  }) as unknown as ClipboardEvent;

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

const orderedLists = (editor: Editor) => {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'orderedList') found.push(node.attrs);
  });
  return found;
};

const GDOCS_LI =
  '<b id="docs-internal-guid-abc"><ol><li style="list-style-type:lower-alpha;"><p><span>one</span></p></li><li style="list-style-type:lower-alpha;"><p><span>two</span></p></li></ol></b>';
const STYLED_OL =
  '<ol style="list-style-type:lower-roman"><li><p>one</p></li></ol>';

describe.each([1, 2])('OrderedList (schema v%i)', (version) => {
  it.each([
    ['1. a\n2. b', ['1. a', '2. b']],
    ['a. x\nb. y', ['a. x', 'b. y']],
  ])('keeps plain-text %j literal', async (text, lines) => {
    const editor = track(makeEditor(version));
    editor.view.pasteText(text, clipboardEvent('', text));
    await flush();
    expect(orderedLists(editor)).toEqual([]);
    lines.forEach((line) =>
      expect(editor.state.doc.textContent).toContain(line),
    );
  });

  it.each([
    ['a Google Docs list-style-type on the li', GDOCS_LI, null],
    ['list-style-type on the ol', STYLED_OL, null],
    ['an <ol type> attribute', '<ol type="a"><li><p>one</p></li></ol>', 'a'],
  ])('reads type only from the attribute: %s', async (_name, html, type) => {
    const editor = track(makeEditor(version));
    editor.view.pasteHTML(html, clipboardEvent(html, 'one'));
    await flush();
    expect(orderedLists(editor).map((attrs) => attrs.type)).toEqual([type]);
  });
});
