/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('Pages: renders an empty, zero-height marker', () => {
    const { container } = renderView(true);
    const marker = container.querySelector('[data-page-break-marker]');
    expect(marker?.classList.contains('h-0')).toBe(true);
    expect(marker?.childElementCount).toBe(0);
    expect(container.querySelector('.color-bg-secondary')).toBeNull();
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
