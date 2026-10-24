import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SearchAndReplace } from './search-replace';

describe('replacing the selected search match', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit, SearchAndReplace],
      content:
        '<p>Sarah prepares the proposal.</p><p>Sarah approves the budget.</p><p>Sarah sends the proposal to the client.</p>',
    });
    editor.commands.setSearchTerm('Sarah');
    editor.commands.setReplaceTerm('James');
  });

  afterEach(() => editor.destroy());

  const paragraphs = () =>
    Array.from(editor.view.dom.querySelectorAll('p'), (p) => p.textContent);

  it('replaces the highlighted second match and preserves the first', () => {
    editor.commands.nextSearchResult();
    editor.commands.replace();

    expect(paragraphs()).toEqual([
      'Sarah prepares the proposal.',
      'James approves the budget.',
      'Sarah sends the proposal to the client.',
    ]);
    expect(
      editor.view.dom.querySelector('.search-result-current')?.closest('p')
        ?.textContent,
    ).toBe('Sarah sends the proposal to the client.');
  });

  it('wraps to the first remaining match after replacing the last match', () => {
    editor.commands.previousSearchResult();
    editor.commands.replace();

    expect(paragraphs()[2]).toBe('James sends the proposal to the client.');
    expect(editor.storage.searchAndReplace.resultIndex).toBe(0);
    expect(
      editor.view.dom.querySelector('.search-result-current')?.closest('p')
        ?.textContent,
    ).toBe('Sarah prepares the proposal.');
    editor.commands.replace();
    expect(paragraphs()[0]).toBe('James prepares the proposal.');
    editor.commands.replace();
    expect(editor.storage.searchAndReplace.results).toHaveLength(0);
    expect(editor.view.dom.querySelector('.search-result-current')).toBeNull();
  });

  it('deletes only the selected match when replacement is empty', () => {
    editor.commands.setReplaceTerm('');
    editor.commands.nextSearchResult();
    editor.commands.replace();

    expect(paragraphs()).toEqual([
      'Sarah prepares the proposal.',
      ' approves the budget.',
      'Sarah sends the proposal to the client.',
    ]);
  });
});
