import {
  IconButton,
  cn,
  LucideIcon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
} from '@fileverse/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CopyAo3Html,
  IEditorToolElement,
  useEditorToolbar,
} from './editor-utils';
import { DdocExportModal } from './export-modal';
import { Editor } from '@tiptap/react';
import { Tab } from './tabs/utils/tab-utils';
import * as Y from 'yjs';
import { useDdocExport } from '../hooks/use-ddoc-export';

const ImportExportButton = ({
  fileExportsOpen,
  setFileExportsOpen,
  exportOptions,
  importOptions,
  editor,
  tabs,
  ydoc,
  copyAo3Html,
  onRegisterExportTrigger,
}: {
  fileExportsOpen: boolean;
  setFileExportsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  exportOptions: (IEditorToolElement | null)[];
  importOptions: (IEditorToolElement | null)[];
  editor: Editor | null;
  tabs: Tab[];
  ydoc: Y.Doc;
  copyAo3Html: CopyAo3Html;
  onRegisterExportTrigger?:
    | ((trigger: ((format?: string, name?: string) => void) | null) => void)
    | undefined;
}) => {
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState('pdf');
  const [pendingExportName, setPendingExportName] = useState<
    string | undefined
  >(undefined);

  const { formatSelectOptions, handleExport, getOptionFormat } = useDdocExport({
    editor,
    tabs,
    ydoc,
    exportOptions,
    copyAo3Html,
  });

  const { printHandler } = useEditorToolbar({ editor });

  const tabSelectOptions = useMemo(
    () => [
      { id: 'current', label: 'Current tab' },
      { id: 'all', label: 'All tabs' },
    ],
    [],
  );
  const hasMultipleTabs = tabs.length > 1;

  const triggerExport = useCallback(
    (format = 'pdf', name?: string) => {
      const formatOption = formatSelectOptions.find(
        (option) => option.id === format,
      );
      if (!formatOption) return;

      setFileExportsOpen(false);
      if (hasMultipleTabs) {
        setSelectedFormat(format);
        setPendingExportName(name);
        setModalOpen(true);
        return;
      }

      handleExport({ format, tab: 'current', name });
    },
    [formatSelectOptions, setFileExportsOpen, hasMultipleTabs, handleExport],
  );
  useEffect(() => {
    onRegisterExportTrigger?.(triggerExport);

    return () => {
      onRegisterExportTrigger?.(null);
    };
  }, [onRegisterExportTrigger, triggerExport]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon="File"
            variant="ghost"
            size="sm"
            isActive={fileExportsOpen}
            className={cn(
              'color-text-default',
              fileExportsOpen && 'color-text-on-brand',
            )}
            data-testid="export-import-dropdown"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[13.75rem] space-y-1" align="start">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <div className="flex items-center space-x-2">
                <LucideIcon name="FileExport" className="w-5 h-5" />
                <span className="text-body-sm">Export</span>
              </div>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={6}>
              {exportOptions
                .filter((option) => option !== null)
                .map((option, index) => (
                  <DropdownMenuItem
                    key={index}
                    disabled={option?.disabled}
                    onClick={() => {
                      if (option?.disabled) return;
                      const format = getOptionFormat(option.title);
                      triggerExport(format || undefined);
                    }}
                    className={cn(
                      'min-h-8 rounded p-2 w-full text-left flex items-center justify-between transition text-body-sm',
                      option?.disabled
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:color-bg-default-hover',
                    )}
                    data-testid={`export-${option?.title?.match(/\(\.(\w+)\)/)?.[1] || option?.title?.toLowerCase().replace(/[^a-z]/g, '-')}`}
                  >
                    <div className="flex flex-col">
                      <span className="text-body-sm">{option?.title}</span>
                      {option?.subtitle && (
                        <span className="text-xs leading-tight color-text-secondary">
                          {option.subtitle}
                        </span>
                      )}
                    </div>
                    {option?.isNew && (
                      <p className="max-h-[16px] flex items-center text-[8px] color-bg-brand text-black rounded p-1 font-semibold">
                        NEW
                      </p>
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <div className="flex items-center space-x-2">
                <LucideIcon name="FileImport" className="w-5 h-5" />
                <span className="text-body-sm">Import</span>
              </div>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={6}>
              {importOptions
                .filter((option) => option !== null)
                .map((option, index) => (
                  <DropdownMenuItem
                    key={index}
                    className="hover:color-bg-default-hover h-8 rounded p-2 w-full text-left flex items-center justify-between transition text-body-sm"
                    data-testid={`import-${option?.title?.match(/\(\.(\w+)\)/)?.[1] || option?.title?.toLowerCase().replace(/[^a-z]/g, '-')}`}
                    onClick={() => option.onClick()}
                  >
                    <span className="text-body-sm">{option?.title}</span>
                    {option?.isNew && (
                      <p className="max-h-[16px] flex items-center text-[8px] color-bg-brand text-black rounded p-1 font-semibold">
                        NEW
                      </p>
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            className="appearance-none bg-transparent hover:color-bg-default-hover h-8 rounded gap-2 p-2 w-full text-left flex items-center justify-start transition text-body-sm"
            onClick={printHandler}
          >
            <LucideIcon name={'Printer'} />
            Print
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {hasMultipleTabs && (
        <DdocExportModal
          open={isModalOpen}
          onOpenChange={setModalOpen}
          onExport={({ format, tab }) =>
            handleExport({ format, tab, name: pendingExportName })
          }
          formatOptions={formatSelectOptions}
          tabOptions={tabSelectOptions}
          initialFormat={selectedFormat}
          initialTab="current"
        />
      )}
    </>
  );
};

export { ImportExportButton };
