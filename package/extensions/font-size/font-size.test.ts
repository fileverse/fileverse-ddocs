import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import {
  destroyTracked,
  endOf,
  makeEditor,
  startOf,
  track,
} from '../caret-marks/test-helpers';

afterEach(destroyTracked);

const pressFontSizeShortcut = (editor: Editor, increase: boolean) => {
  const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', {
    key: increase ? '>' : '<',
    code: increase ? 'Period' : 'Comma',
    keyCode: increase ? 190 : 188,
    shiftKey: true,
    metaKey: mac,
    ctrlKey: !mac,
    bubbles: true,
    cancelable: true,
  });
  expect(
    editor.view.someProp('handleKeyDown', (handle) =>
      handle(editor.view, event),
    ),
  ).toBe(true);
};

const selectTitle = (editor: Editor, cursorOnly: boolean) => {
  editor.commands.setTextSelection({
    from: cursorOnly ? endOf(editor, 'Title') : startOf(editor, 'Title'),
    to: endOf(editor, 'Title'),
  });
};

describe.each([1, 2])('font size shortcuts (schema v%i)', (schemaVersion) => {
  describe.each([false, true])('cursor only: %s', (cursorOnly) => {
    it.each([
      [1, '36px', '48px'],
      [2, '30px', '32px'],
      [3, '24px', '30px'],
    ])(
      'increases default Heading %i on every press',
      (level, first, second) => {
        const editor = track(
          makeEditor(schemaVersion, `<h${level}>Title</h${level}>`),
        );
        selectTitle(editor, cursorOnly);

        pressFontSizeShortcut(editor, true);
        expect(editor.getAttributes('textStyle').fontSize).toBe(first);
        pressFontSizeShortcut(editor, true);
        expect(editor.getAttributes('textStyle').fontSize).toBe(second);
        if (cursorOnly) editor.commands.insertContent('!');
        const span = editor.view.dom.querySelector(
          `h${level} span[style*="font-size"]`,
        ) as HTMLElement;
        expect(span.textContent).toBe(cursorOnly ? '!' : 'Title');
        expect(span.style.fontSize).toBe(second);
      },
    );

    it.each([
      [1, '30px'],
      [2, '18px'],
      [3, '16px'],
    ])('decreases default Heading %i by one step', (level, expected) => {
      const editor = track(
        makeEditor(schemaVersion, `<h${level}>Title</h${level}>`),
      );
      selectTitle(editor, cursorOnly);
      pressFontSizeShortcut(editor, false);
      expect(editor.getAttributes('textStyle').fontSize).toBe(expected);
    });
  });

  it.each([
    ['<h1><span style="font-size: 24px">Title</span></h1>', '30px'],
    ['<p style="font-size: 24px">Title</p>', '30px'],
    ['<p>Title</p>', '18px'],
  ])(
    'preserves explicit sizes and paragraph defaults: %s',
    (html, expected) => {
      const editor = track(makeEditor(schemaVersion, html));
      selectTitle(editor, false);
      pressFontSizeShortcut(editor, true);
      expect(editor.getAttributes('textStyle').fontSize).toBe(expected);
    },
  );
});
