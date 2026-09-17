import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import {
  findWordRangeAtCursor,
  selectWordAtCursor,
  hasTextTargetAtSelection,
} from './selection-utils';
import { makeEditor } from './make-editor';

/**
 * Builds a NodeSelection on a horizontal rule that is not adjacent to any
 * text. The schema wraps every top-level block (including the hr) in its
 * own dBlock node (see package/extensions/doc.ts: `content: 'dBlock+'`), so
 * the hr's immediate parent is an empty dBlock — $from.parent.textContent
 * is '' and findWordRangeAtCursor correctly reports "no word here" rather
 * than bleeding into a neighboring paragraph's text.
 */
const selectHorizontalRuleNode = (editor: Editor) => {
  editor.commands.insertContent('<p>hello world</p>');
  editor.commands.setHorizontalRule();
  editor.commands.insertContent('<p>another paragraph</p>');
  let hrPos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'horizontalRule') hrPos = pos;
  });
  editor.commands.setNodeSelection(hrPos);
};

describe('findWordRangeAtCursor', () => {
  let editor: Editor;
  afterEach(() => {
    editor.destroy();
  });

  it('returns the word range with the cursor mid-word', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 2); // inside "hello", between "he" and "llo"
    const range = findWordRangeAtCursor(editor)!;
    expect(editor.state.doc.textBetween(range.from, range.to)).toBe('hello');
  });

  it('returns the word range with the cursor at a word end before a space', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello world');
    const base = editor.state.selection.$from.start();
    // position the cursor right after "hello" (adjacent to the space)
    editor.commands.setTextSelection(base + 'hello'.length);
    const range = findWordRangeAtCursor(editor);
    expect(range).not.toBeNull();
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('hello');
  });

  it('falls back to the word before the cursor inside a whitespace run', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello  world'); // two spaces, insertContent preserves them
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 6); // between the two spaces
    const range = findWordRangeAtCursor(editor);
    expect(range).not.toBeNull();
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('hello');
  });

  it('falls back to the word after the cursor when nothing precedes it', () => {
    editor = makeEditor();
    editor.commands.insertContent('  world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 1); // inside the leading spaces
    const range = findWordRangeAtCursor(editor);
    expect(range).not.toBeNull();
    expect(editor.state.doc.textBetween(range!.from, range!.to)).toBe('world');
  });

  it('returns null in a block of only whitespace', () => {
    editor = makeEditor();
    editor.commands.insertContent('   ');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 1);
    expect(findWordRangeAtCursor(editor)).toBeNull();
  });

  it('returns null on an empty block', () => {
    editor = makeEditor();
    expect(findWordRangeAtCursor(editor)).toBeNull();
  });
});

describe('selectWordAtCursor', () => {
  let editor: Editor;
  afterEach(() => {
    editor.destroy();
  });

  it('keeps an existing non-empty selection untouched', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection({ from: base, to: base + 5 }); // "hello"
    expect(selectWordAtCursor(editor)).toBe(true);
    expect(editor.state.selection.to - editor.state.selection.from).toBe(5);
  });

  it('selects the word under a collapsed cursor', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 2);
    expect(selectWordAtCursor(editor)).toBe(true);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('hello');
  });

  it('selects the previous word from a whitespace run (parity with findWordRangeAtCursor)', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello  world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 6);
    expect(selectWordAtCursor(editor)).toBe(true);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('hello');
  });

  it('returns false for a NodeSelection not adjacent to a word (horizontal rule)', () => {
    editor = makeEditor();
    selectHorizontalRuleNode(editor);
    expect(editor.state.selection.empty).toBe(false); // node selections are never "empty"
    expect(selectWordAtCursor(editor)).toBe(false);
  });
});

describe('hasTextTargetAtSelection', () => {
  let editor: Editor;
  afterEach(() => {
    editor.destroy();
  });

  it('is true for a non-empty TextSelection', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection({ from: base, to: base + 5 });
    expect(hasTextTargetAtSelection(editor)).toBe(true);
  });

  it('is true for a collapsed cursor mid-word', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 2);
    expect(hasTextTargetAtSelection(editor)).toBe(true);
  });

  it('is true for a collapsed cursor in a whitespace run of a block with words', () => {
    editor = makeEditor();
    editor.commands.insertContent('hello  world');
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 6);
    expect(hasTextTargetAtSelection(editor)).toBe(true);
  });

  it('is false for a collapsed cursor in an empty block', () => {
    editor = makeEditor();
    expect(hasTextTargetAtSelection(editor)).toBe(false);
  });

  it('is false for a NodeSelection not adjacent to a word (horizontal rule)', () => {
    editor = makeEditor();
    selectHorizontalRuleNode(editor);
    expect(hasTextTargetAtSelection(editor)).toBe(false);
  });
});
