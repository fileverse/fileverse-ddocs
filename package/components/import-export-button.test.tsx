import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ImportExportButton } from './import-export-button';

const mocks = vi.hoisted(() => ({
  handleExport: vi.fn(),
}));

vi.mock('@fileverse/ui', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    IconButton: () => <button />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    LucideIcon: () => null,
    DropdownMenu: Wrapper,
    DropdownMenuTrigger: Wrapper,
    DropdownMenuContent: Wrapper,
    DropdownMenuSub: Wrapper,
    DropdownMenuSubTrigger: Wrapper,
    DropdownMenuSubContent: Wrapper,
    DropdownMenuItem: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
  };
});

vi.mock('./editor-utils', () => ({
  useEditorToolbar: () => ({ printHandler: vi.fn() }),
}));

vi.mock('../hooks/use-ddoc-export', () => ({
  useDdocExport: () => ({
    formatSelectOptions: [
      { id: 'html', label: 'Web page (.html)' },
      { id: 'ao3-html', label: 'Copy to AO3 (HTML)' },
    ],
    handleExport: mocks.handleExport,
    getOptionFormat: (title: string) =>
      title === 'Copy to AO3 (HTML)' ? 'ao3-html' : 'html',
  }),
}));

vi.mock('./export-modal', () => ({
  DdocExportModal: ({
    open,
    initialFormat,
    formatOptions,
    onExport,
  }: {
    open: boolean;
    initialFormat: string;
    formatOptions: Array<{ id: string }>;
    onExport: (data: { format: string; tab: string }) => void;
  }) =>
    open ? (
      <button
        data-testid="export-modal"
        data-format={initialFormat}
        data-options={formatOptions.map((option) => option.id).join(',')}
        onClick={() => onExport({ format: initialFormat, tab: 'all' })}
      >
        Export all tabs
      </button>
    ) : null,
}));

describe('ImportExportButton AO3 modal routing', () => {
  beforeEach(() => mocks.handleExport.mockReset());

  const renderButton = (tabCount: number) => {
    let registeredTrigger: ((format?: string, name?: string) => void) | null =
      null;

    render(
      <ImportExportButton
        fileExportsOpen={false}
        setFileExportsOpen={vi.fn()}
        exportOptions={[
          {
            icon: 'FileText',
            title: 'Copy to AO3 (HTML)',
            onClick: vi.fn(),
            isActive: false,
          },
        ]}
        importOptions={[]}
        editor={{} as Editor}
        tabs={Array.from({ length: tabCount }, (_, index) => ({
          id: `tab-${index + 1}`,
          name: `Tab ${index + 1}`,
          emoji: null,
        }))}
        ydoc={new Y.Doc()}
        copyAo3Html={vi.fn()}
        onRegisterExportTrigger={(trigger) => {
          registeredTrigger = trigger;
        }}
      />,
    );

    return () => registeredTrigger;
  };

  it('opens the existing modal with AO3 selected for multi-tab documents', async () => {
    const getRegisteredTrigger = renderButton(2);
    await waitFor(() => expect(getRegisteredTrigger()).toBeTypeOf('function'));

    act(() => getRegisteredTrigger()?.('ao3-html'));

    const modal = screen.getByTestId('export-modal');
    expect(modal.getAttribute('data-format')).toBe('ao3-html');
    expect(modal.getAttribute('data-options')).toBe('html,ao3-html');

    fireEvent.click(modal);
    expect(mocks.handleExport).toHaveBeenCalledWith({
      format: 'ao3-html',
      tab: 'all',
      name: undefined,
    });
  });

  it('copies the current tab immediately for single-tab documents', async () => {
    const getRegisteredTrigger = renderButton(1);
    await waitFor(() => expect(getRegisteredTrigger()).toBeTypeOf('function'));

    act(() => getRegisteredTrigger()?.('ao3-html'));

    expect(screen.queryByTestId('export-modal')).toBeNull();
    expect(mocks.handleExport).toHaveBeenCalledWith({
      format: 'ao3-html',
      tab: 'current',
      name: undefined,
    });
  });
});
