import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, JSONContent } from '@tiptap/react';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';
import {
  DdocExportModalProps,
  ExportTabOption,
} from '../components/export-modal';
import { IEditorToolElement } from '../components/editor-utils';
import {
  DEFAULT_TAB_ID,
  deriveTabsFromEncodedState,
  Tab,
} from '../components/tabs/utils/tab-utils';
import { useDdocExport } from './use-ddoc-export';
import { extractTitleFromContent } from '../utils/extract-title-from-content';
import { getTemporaryEditor } from '../utils/helpers';
import { handleContentPrint } from '../utils/handle-print';
import {
  useHeadlessEditor,
  UseHeadlessEditorProps,
} from './use-headless-editor';

export type HeadlessEditorExportFormat = 'pdf' | 'md' | 'html' | 'txt' | 'odt';

export interface HeadlessEditorExportOption {
  content: string;
  fileName?: string;
  initialFormat?: HeadlessEditorExportFormat;
}

interface DdocExportSession {
  editor: Editor;
  ydoc: Y.Doc;
  tabs: Tab[];
  activeTabId: string;
  exportName: string;
  initialFormat: HeadlessEditorExportFormat;
}

const HEADLESS_EXPORT_FORMATS: HeadlessEditorExportFormat[] = [
  'pdf',
  'md',
  'html',
  'txt',
  'odt',
];

const isSupportedFormat = (
  format?: string,
): format is HeadlessEditorExportFormat =>
  format !== undefined &&
  HEADLESS_EXPORT_FORMATS.includes(format as HeadlessEditorExportFormat);

export const useExportHeadlessEditorContent = (
  props?: UseHeadlessEditorProps & { onExportError?: (error: unknown) => void },
) => {
  const activeSessionRef = useRef<DdocExportSession | null>(null);
  const isExportInProgressRef = useRef(false);
  const [ddocExportSession, setDdocExportSession] =
    useState<DdocExportSession | null>(null);
  const [isExportModalOpen, setDdocExportModalOpen] = useState(false);

  const headlessEditor = useHeadlessEditor(props);
  const { getEditor, setContent } = headlessEditor;

  const destroyEditorAndDoc = useCallback(
    (editor?: Editor | null, ydoc?: Y.Doc | null) => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
      if (ydoc && !ydoc.isDestroyed) {
        ydoc.destroy();
      }
    },
    [],
  );

  const setExportSession = useCallback(
    (nextSession: DdocExportSession | null) => {
      const previousSession = activeSessionRef.current;

      if (previousSession) {
        destroyEditorAndDoc(previousSession.editor, previousSession.ydoc);
      }

      activeSessionRef.current = nextSession;
      setDdocExportSession(nextSession);
    },
    [destroyEditorAndDoc],
  );

  const clearExportSession = useCallback(() => {
    setDdocExportModalOpen(false);
    setExportSession(null);
  }, [setExportSession]);

  const onExportModalVisibilityChange = useCallback(
    (open: boolean) => {
      setDdocExportModalOpen(open);

      if (open) return;
      if (isExportInProgressRef.current) return;

      setExportSession(null);
    },
    [setExportSession],
  );

  useEffect(() => {
    return () => {
      if (activeSessionRef.current) {
        destroyEditorAndDoc(
          activeSessionRef.current.editor,
          activeSessionRef.current.ydoc,
        );
        activeSessionRef.current = null;
      }
    };
  }, [destroyEditorAndDoc]);

  const getTabContent = useCallback((ydoc: Y.Doc, tabId: string) => {
    const fragment = ydoc.getXmlFragment(tabId);
    return yXmlFragmentToProsemirrorJSON(fragment) as JSONContent;
  }, []);

  const extractTabTitle = useCallback((tabContent: JSONContent) => {
    return (
      extractTitleFromContent(
        tabContent as unknown as { content: JSONContent },
      ) || null
    );
  }, []);

  const triggerUrlDownload = useCallback((url: string, fileName: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const createTempEditorForActiveTab = useCallback(() => {
    if (!ddocExportSession) return null;
    const tabId = ddocExportSession.activeTabId;
    const tabContent = getTabContent(ddocExportSession.ydoc, tabId);

    return getTemporaryEditor(ddocExportSession.editor, tabContent);
  }, [getTabContent, ddocExportSession]);

  const exportOptions = useMemo<(IEditorToolElement | null)[]>(() => {
    if (!ddocExportSession) return [];
    return [
      {
        icon: 'FileExport',
        title: 'PDF document (.pdf)',
        onClick: () => {
          const tempEditor = createTempEditorForActiveTab();
          if (!tempEditor) return;

          try {
            handleContentPrint(tempEditor.getHTML());
          } finally {
            tempEditor.destroy();
          }
        },
        isActive: false,
      },
      {
        icon: 'FileText',
        title: 'Web page (.html)',
        onClick: async (name?: string) => {
          const tempEditor = createTempEditorForActiveTab();
          if (!tempEditor) return;

          try {
            const fileName =
              name ||
              ddocExportSession.exportName ||
              extractTabTitle(tempEditor.getJSON()) ||
              'Untitled';
            const generateDownloadUrl =
              await tempEditor.commands.exportHtmlFile({
                title: fileName,
              });
            if (generateDownloadUrl) {
              triggerUrlDownload(generateDownloadUrl, `${fileName}.html`);
            }
          } finally {
            tempEditor.destroy();
          }
        },
        isActive: false,
      },
      {
        icon: 'FileText',
        title: 'Plain Text (.txt)',
        onClick: async (name?: string) => {
          const tempEditor = createTempEditorForActiveTab();
          if (!tempEditor) return;

          try {
            const title = extractTabTitle(tempEditor.getJSON());
            const fileName =
              name || ddocExportSession.exportName || title || 'Untitled';
            const generateDownloadUrl = await tempEditor.commands.exportTxtFile(
              {
                title: fileName,
              },
            );
            if (generateDownloadUrl) {
              triggerUrlDownload(generateDownloadUrl, `${fileName}.txt`);
            }
          } finally {
            tempEditor.destroy();
          }
        },
        isActive: false,
      },
      {
        icon: 'FileOutput',
        title: 'Markdown (.md)',
        onClick: async (name?: string) => {
          const tempEditor = createTempEditorForActiveTab();
          if (!tempEditor) return;

          try {
            const fileName =
              name ||
              ddocExportSession.exportName ||
              extractTabTitle(tempEditor.getJSON()) ||
              'Untitled';
            const generateDownloadUrl =
              await tempEditor.commands.exportMarkdownFile({
                title: fileName,
              });
            if (generateDownloadUrl) {
              triggerUrlDownload(generateDownloadUrl, `${fileName}.md`);
            }
          } finally {
            tempEditor.destroy();
          }
        },
        isActive: false,
      },
      {
        icon: 'FileText',
        title: 'OpenDocument (.odt)',
        subtitle: 'Image support is coming soon',
        onClick: async (name?: string) => {
          const tempEditor = createTempEditorForActiveTab();
          if (!tempEditor) return;

          try {
            const fileName =
              name ||
              ddocExportSession.exportName ||
              extractTabTitle(tempEditor.getJSON()) ||
              'Untitled';
            const generateDownloadUrl = await tempEditor.commands.exportOdtFile(
              {
                title: fileName,
              },
            );
            if (generateDownloadUrl) {
              triggerUrlDownload(generateDownloadUrl, `${fileName}.odt`);
            }
          } finally {
            tempEditor.destroy();
          }
        },
        isActive: false,
      },
    ];
  }, [
    createTempEditorForActiveTab,
    extractTabTitle,
    ddocExportSession,
    triggerUrlDownload,
  ]);

  const {
    formatSelectOptions: formatOptions,
    handleExportAsync: handleExportContent,
  } = useDdocExport({
    editor: ddocExportSession?.editor ?? null,
    tabs: ddocExportSession?.tabs ?? [],
    ydoc: ddocExportSession?.ydoc ?? null,
    exportOptions,
  });

  const tabOptions = useMemo<ExportTabOption[]>(() => {
    if (!ddocExportSession || ddocExportSession.tabs.length <= 1) {
      return [{ id: 'current', label: 'Current tab' }];
    }

    return [
      { id: 'current', label: 'Current tab' },
      { id: 'all', label: 'All tabs' },
    ];
  }, [ddocExportSession]);

  const exportContent = useCallback(
    (option: HeadlessEditorExportOption) => {
      if (isExportInProgressRef.current) return;

      setDdocExportModalOpen(false);
      setExportSession(null);

      const { editor, ydoc } = getEditor();

      try {
        setContent(option.content, editor, ydoc);

        const { tabList, activeTabId } = deriveTabsFromEncodedState(
          option.content,
          ydoc,
        );
        const resolvedActiveTabId =
          activeTabId || tabList[0]?.id || DEFAULT_TAB_ID;
        const exportName = option.fileName || 'Untitled';

        const nextSession: DdocExportSession = {
          editor,
          ydoc,
          tabs: tabList,
          activeTabId: resolvedActiveTabId,
          exportName,
          initialFormat: isSupportedFormat(option.initialFormat)
            ? option.initialFormat
            : 'pdf',
        };

        setExportSession(nextSession);
        setDdocExportModalOpen(true);
      } catch (error) {
        destroyEditorAndDoc(editor, ydoc);
        throw error;
      }
    },
    [
      destroyEditorAndDoc,
      getEditor,
      setContent,
      setExportSession,
      setDdocExportModalOpen,
    ],
  );

  const onExport = useCallback(
    async ({ format, tab }: { format: string; tab: string }) => {
      if (!ddocExportSession) return;

      isExportInProgressRef.current = true;
      handleExportContent({
        format,
        tab,
        name: ddocExportSession.exportName,
      })
        .finally(() => {
          isExportInProgressRef.current = false;
          clearExportSession();
        })
        .catch((error) => {
          console.log('Export failed:', error);
          props?.onExportError?.(error);
        });
    },
    [clearExportSession, handleExportContent, ddocExportSession],
  );

  const exportModalProps = useMemo<DdocExportModalProps>(
    () => ({
      open: isExportModalOpen && ddocExportSession !== null,
      onOpenChange: onExportModalVisibilityChange,
      onExport,
      formatOptions,
      tabOptions,
      initialFormat: ddocExportSession?.initialFormat ?? 'pdf',
      initialTab: 'current',
    }),
    [
      ddocExportSession,
      formatOptions,
      tabOptions,
      isExportModalOpen,
      onExportModalVisibilityChange,
      onExport,
    ],
  );

  return {
    ...headlessEditor,
    exportContent,
    exportModalProps,
  };
};
