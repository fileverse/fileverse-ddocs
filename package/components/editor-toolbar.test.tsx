import { render, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import TiptapToolBar from './editor-toolbar';

// Only the leading slot's placement is under test; every child control is a
// stub so the toolbar renders without a live editor.
vi.mock('@fileverse/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  IconButton: () => <button />,
  Skeleton: () => <div />,
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock('./editor-utils', () => ({
  useEditorToolbar: () => ({
    toolbar: [],
    undoRedoTools: [],
    importOptions: [],
    exportOptions: [],
    copyAo3Html: vi.fn(),
    fileExportsOpen: false,
    setFileExportsOpen: vi.fn(),
  }),
}));

vi.mock('../hooks/use-editor-states', () => ({
  useEditorStates: () => ({}),
}));

vi.mock('./import-export-button', () => ({
  ImportExportButton: () => <button data-testid="import-export" />,
}));

vi.mock('./motion-div', () => ({
  fadeInTransition: (node: React.ReactNode) => node,
  slideUpTransition: (node: React.ReactNode) => node,
}));

vi.mock('./editor-toolbar/zoom-level', () => ({
  ZoomLevelDropdown: () => null,
}));
vi.mock('./editor-toolbar/font-family', () => ({
  FontFamilyDropdown: () => null,
}));
vi.mock('./editor-toolbar/heading', () => ({ HeadingDropdown: () => null }));
vi.mock('./editor-toolbar/font-size', () => ({ FontSizeDropdown: () => null }));
vi.mock('./editor-toolbar/line-height', () => ({
  LineHeightDropdown: () => null,
}));
vi.mock('./editor-toolbar/highlight', () => ({
  HighlightDropdown: () => null,
}));
vi.mock('./editor-toolbar/text-color', () => ({
  TextColorDropdown: () => null,
}));
vi.mock('./editor-toolbar/alignment', () => ({
  AlignmentDropdown: () => null,
}));
vi.mock('./editor-toolbar/link', () => ({ LinkPopover: () => null }));

const renderToolbar = (renderToolbarLeading?: () => React.ReactNode) =>
  render(
    <TiptapToolBar
      editor={{ commands: { focus: vi.fn() } } as unknown as Editor}
      setIsPresentationMode={vi.fn()}
      zoomLevel="1"
      setZoomLevel={vi.fn()}
      isNavbarVisible
      setIsNavbarVisible={vi.fn()}
      isLoading={false}
      tabs={[]}
      ydoc={new Y.Doc()}
      renderToolbarLeading={renderToolbarLeading}
    />,
  );

describe('TiptapToolBar renderToolbarLeading', () => {
  it('renders the host item before the import/export button', () => {
    renderToolbar(() => <button data-testid="leading" />);

    const leading = screen.getByTestId('leading');
    const importExport = screen.getByTestId('import-export');
    expect(
      leading.compareDocumentPosition(importExport) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Grouped with the import/export button: no divider between them.
    expect(leading.nextElementSibling).toBe(importExport);
  });

  it('renders nothing extra when the prop is omitted or returns null', () => {
    const { container, rerender } = renderToolbar();
    const firstGroup = container.querySelector('.flex.h-9.gap-1');
    expect(firstGroup?.firstElementChild).toBe(
      screen.getByTestId('import-export'),
    );

    rerender(
      <TiptapToolBar
        editor={{ commands: { focus: vi.fn() } } as unknown as Editor}
        setIsPresentationMode={vi.fn()}
        zoomLevel="1"
        setZoomLevel={vi.fn()}
        isNavbarVisible
        setIsNavbarVisible={vi.fn()}
        isLoading={false}
        tabs={[]}
        ydoc={new Y.Doc()}
        renderToolbarLeading={() => null}
      />,
    );
    expect(container.querySelector('.flex.h-9.gap-1')?.firstElementChild).toBe(
      screen.getByTestId('import-export'),
    );
  });
});
