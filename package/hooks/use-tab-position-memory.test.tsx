// package/hooks/use-tab-position-memory.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { getHeadlessExtensions } from './use-headless-editor';
import { useTabPositionMemory } from './use-tab-position-memory';
import {
  clearTabPositionStore,
  getTabPositionKey,
  markTabInteracted,
  recordTabCursor,
  recordTabScrollFallback,
} from '../utils/tab-position-memory';

const buildProps = (
  editor: Editor,
  activeTabId: string,
  setActiveTabId: (id: string) => void,
  overrides: Partial<Parameters<typeof useTabPositionMemory>[0]> = {},
) => ({
  editor,
  activeTabId,
  ddocId: 'doc-1',
  setActiveTabId,
  isContentLoading: false,
  isNativeMobile: false,
  disabled: false,
  ...overrides,
});

describe('useTabPositionMemory', () => {
  let ydoc: Y.Doc;
  let container: HTMLDivElement;
  let editorA: Editor;
  let editorB: Editor;

  beforeEach(() => {
    clearTabPositionStore();
    ydoc = new Y.Doc();
    container = document.createElement('div');
    container.setAttribute('data-editor-scroll-container', 'true');
    // jsdom reports 0 dimensions; getEditorScrollContainer requires
    // clientHeight > 0 to pick the explicit container.
    Object.defineProperty(container, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(container, 'scrollHeight', {
      value: 2000,
      configurable: true,
    });
    document.body.appendChild(container);
    editorA = new Editor({
      extensions: getHeadlessExtensions({ ydoc, field: 'tab-a' }),
    });
    editorB = new Editor({
      extensions: getHeadlessExtensions({ ydoc, field: 'tab-b' }),
    });
    container.appendChild(editorA.view.dom);
    container.appendChild(editorB.view.dom);
    editorA.commands.insertContent('content for tab a, long enough to click');
    editorB.commands.insertContent('content for tab b');
  });

  afterEach(() => {
    editorA.destroy();
    editorB.destroy();
    ydoc.destroy();
    container.remove();
  });

  it('delegates the switch and restores the scroll fallback for cursorless tabs', () => {
    const setActiveTabId = vi.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorA, 'tab-a', setActiveTabId) },
    );

    container.scrollTop = 480;
    result.current.switchTab('tab-b');
    expect(setActiveTabId).toHaveBeenCalledWith('tab-b');

    rerender(buildProps(editorB, 'tab-b', setActiveTabId));
    expect(container.scrollTop).toBe(0); // nothing stored for tab-b yet

    result.current.switchTab('tab-a');
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(container.scrollTop).toBe(480); // no cursor in tab-a → fallback
  });

  it('restores the recorded cursor selection after interaction', () => {
    const setActiveTabId = vi.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorA, 'tab-a', setActiveTabId) },
    );

    editorA.view.dom.dispatchEvent(new Event('pointerdown'));
    editorA.commands.setTextSelection(8); // fires selectionUpdate → recorded

    result.current.switchTab('tab-b');
    rerender(buildProps(editorB, 'tab-b', setActiveTabId));

    // Simulate what teardown/autofocus does to the hidden editor's selection.
    editorA.commands.setTextSelection(1);

    result.current.switchTab('tab-a');
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(editorA.state.selection.head).toBe(8);
  });

  it('ignores selections made without user interaction (Q9)', () => {
    const setActiveTabId = vi.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorA, 'tab-a', setActiveTabId) },
    );

    editorA.commands.setTextSelection(8); // no pointerdown/keydown first
    container.scrollTop = 300;

    result.current.switchTab('tab-b');
    rerender(buildProps(editorB, 'tab-b', setActiveTabId));
    editorA.commands.setTextSelection(2);

    result.current.switchTab('tab-a');
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(editorA.state.selection.head).toBe(2); // NOT restored
    expect(container.scrollTop).toBe(300); // fallback used instead
  });

  it('keeps the old reset-to-top behavior when disabled', () => {
    const setActiveTabId = vi.fn();
    const key = getTabPositionKey('doc-1', 'tab-a');
    markTabInteracted(key);
    recordTabScrollFallback(key, 480);

    const { rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      {
        initialProps: buildProps(editorB, 'tab-b', setActiveTabId, {
          disabled: true,
        }),
      },
    );

    container.scrollTop = 250;
    rerender(buildProps(editorA, 'tab-a', setActiveTabId, { disabled: true }));
    expect(container.scrollTop).toBe(0); // stored 480 ignored
  });

  it('falls back to scroll when the stored cursor belongs to another document', () => {
    const setActiveTabId = vi.fn();
    const key = getTabPositionKey('doc-1', 'tab-a');
    markTabInteracted(key);
    recordTabCursor(key, {
      relAnchor: null,
      relHead: null,
      absAnchor: 5,
      absHead: 5,
      docGuid: 'foreign-doc',
    });
    recordTabScrollFallback(key, 300);

    const { rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorB, 'tab-b', setActiveTabId) },
    );

    const before = editorA.state.selection.head;
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(editorA.state.selection.head).toBe(before); // cursor NOT applied
    expect(container.scrollTop).toBe(300); // degraded to scroll rung
  });

  it('leaves scroll untouched during the stale commit where the editor is still inactive', () => {
    const setActiveTabId = vi.fn();
    recordTabScrollFallback(getTabPositionKey('doc-1', 'tab-a'), 480);
    editorA.view.dom.setAttribute('data-ddoc-editor-inactive', 'true');

    const { rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorB, 'tab-b', setActiveTabId) },
    );

    container.scrollTop = 123;
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(container.scrollTop).toBe(123); // guard bailed before any write

    editorA.view.dom.removeAttribute('data-ddoc-editor-inactive');
  });
});
