/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageBreakNodeView } from './page-break-node-view';

const ctx = vi.hoisted(() => ({ isPreviewMode: false, isFocusMode: false }));

vi.mock('@tiptap/react', () => ({
  NodeViewWrapper: ({ children, ...rest }: any) => (
    <div {...rest}>{children}</div>
  ),
}));
vi.mock('@fileverse/ui', () => ({
  LucideIcon: ({ name, onClick }: any) => (
    <button data-testid="icon" data-name={name} onClick={onClick} />
  ),
  Tooltip: ({ text, children }: any) => (
    <div data-tooltip={text}>{children}</div>
  ),
}));
vi.mock('../../hooks/use-editing-context', () => ({
  useEditingContext: () => ({ isPreviewMode: ctx.isPreviewMode }),
}));
vi.mock('../../context/editor-context', () => ({
  useEditorContext: () => ({
    documentStyling: undefined,
    theme: 'light',
    isFocusMode: ctx.isFocusMode,
  }),
}));

const makeEditor = (enabled: boolean | undefined) => {
  const storage: any = {};
  if (enabled !== undefined) {
    storage.pagination = {
      store: { subscribe: () => () => {}, get: () => ({ enabled }) },
    };
  }
  return { storage, commands: { unsetPageBreak: vi.fn() } } as any;
};

const renderView = (enabled: boolean | undefined) => {
  const editor = makeEditor(enabled);
  const deleteNode = vi.fn();
  const view = render(
    <PageBreakNodeView {...({ editor, deleteNode } as any)} />,
  );
  return { editor, deleteNode, ...view };
};

describe('PageBreakNodeView', () => {
  beforeEach(() => {
    ctx.isPreviewMode = false;
    ctx.isFocusMode = false;
  });

  it('Pages: renders the thin marker (no grey strip) with the remove control', () => {
    const { container } = renderView(true);
    expect(container.querySelector('.color-bg-secondary')).toBeNull();
    expect(container.querySelector('[data-page-break-marker]')).not.toBeNull();
    expect(
      container.querySelector('[data-tooltip="Remove page breaker"]'),
    ).not.toBeNull();
    expect(screen.getByTestId('icon').dataset.name).toBe('PageBreakRemove');
    expect(
      container.querySelector('br[data-type="page-break"]'),
    ).not.toBeNull();
  });

  it('Pages: clicking remove deletes the node', () => {
    const { editor, deleteNode } = renderView(true);
    fireEvent.click(screen.getByTestId('icon'));
    expect(editor.commands.unsetPageBreak).toHaveBeenCalled();
    expect(deleteNode).toHaveBeenCalled();
  });

  it('Pages: preview mode shows no remove control', () => {
    ctx.isPreviewMode = true;
    const { container } = renderView(true);
    expect(screen.queryByTestId('icon')).toBeNull();
    expect(
      container.querySelector('br[data-type="page-break"]'),
    ).not.toBeNull();
  });

  it('Pageless keeps today’s strip', () => {
    const { container } = renderView(false);
    expect(container.querySelector('.color-bg-secondary')).not.toBeNull();
    expect(container.querySelector('[data-page-break-marker]')).toBeNull();
  });

  it('no Pagination extension keeps today’s strip', () => {
    const { container } = renderView(undefined);
    expect(container.querySelector('.color-bg-secondary')).not.toBeNull();
    expect(container.querySelector('[data-page-break-marker]')).toBeNull();
  });

  it('Pageless focus mode keeps the Page break label', () => {
    ctx.isFocusMode = true;
    renderView(false);
    expect(screen.getByText('Page break')).toBeTruthy();
  });

  it('Pageless preview mode renders no remove control', () => {
    ctx.isPreviewMode = true;
    renderView(false);
    expect(screen.queryByTestId('icon')).toBeNull();
  });
});
