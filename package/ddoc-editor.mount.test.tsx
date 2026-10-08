import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import DdocEditor from './ddoc-editor';
import { canUseEditorContainerQueries } from './utils/container-query-support';

vi.mock('./utils/container-query-support', () => ({
  canUseEditorContainerQueries: vi.fn(() => true),
}));

beforeAll(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.scrollBy = vi.fn();
  // The bubble menu's node selector nests a button in a button; React's
  // warning about it is not what this file tests.
  const error = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (!String(args[0]).includes('validateDOMNesting')) error(...args);
  });
});

const mount = async () => {
  const { container } = render(<DdocEditor />);
  // Let the editor's post-mount state updates settle.
  await act(async () => {});
  return container.querySelector<HTMLElement>('.ddoc-editor-root')!;
};

// docs/DROP_IN_EDITOR.md §2.1: the mounted tree, with no UI-state props.
describe('DdocEditor mounted structure', () => {
  it('lays out toolbar, canvas and tab-panel slot under the root', async () => {
    const root = await mount();
    const rows = Array.from(root.children);
    const canvas = root.querySelector('#editor-canvas')!;

    expect(rows.at(-2)).toBe(canvas);
    expect(rows.at(-1)?.classList.contains('ddoc-tab-panel-slot')).toBe(true);
    expect(rows.indexOf(root.querySelector('#toolbar')!)).toBeGreaterThan(-1);
    expect(rows.indexOf(root.querySelector('#toolbar')!)).toBeLessThan(
      rows.indexOf(canvas),
    );

    const scrollers = document.querySelectorAll(
      '[data-editor-scroll-container="true"]',
    );
    expect(Array.from(scrollers)).toEqual([canvas]);
    expect(
      canvas.firstElementChild?.classList.contains('ddoc-drawer-anchor'),
    ).toBe(true);
  });

  it('is a query container only when the safety check passes', async () => {
    expect((await mount()).classList.contains('ddoc-editor-cq')).toBe(true);
    cleanup();
    vi.mocked(canUseEditorContainerQueries).mockReturnValue(false);
    expect((await mount()).classList.contains('ddoc-editor-cq')).toBe(false);
  });
});
