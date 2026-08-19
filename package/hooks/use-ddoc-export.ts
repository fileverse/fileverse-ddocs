import { useCallback, useMemo } from 'react';
import { Editor } from '@tiptap/react';
import { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { CopyAo3Html, IEditorToolElement } from '../components/editor-utils';
import { Tab } from '../components/tabs/utils/tab-utils';
import { stripFrontmatter } from '../extensions/mardown-paste-handler';
import { extractTitleFromContent } from '../utils/extract-title-from-content';
import { getTemporaryEditor } from '../utils/helpers';
import { handleContentPrint } from '../utils/handle-print';
import { htmlToOdt } from 'odf-kit';
import { preprocessHtml } from '../extensions/odt-export';

interface UseDdocExportArgs {
  editor: Editor | null;
  tabs: Tab[];
  ydoc: Y.Doc | null;
  exportOptions: (IEditorToolElement | null)[];
  copyAo3Html?: CopyAo3Html;
}

const useDdocExport = ({
  editor,
  tabs,
  ydoc,
  exportOptions,
  copyAo3Html,
}: UseDdocExportArgs) => {
  const normalizeTabTitle = useCallback(
    (title?: string) => (title || 'Untitled').replace(/\s+/g, ' ').trim(),
    [],
  );

  const escapeHtml = useCallback(
    (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    [],
  );

  const getOptionFormat = useCallback((title: string) => {
    if (title === 'Copy HTML') return 'ao3-html';
    if (title.includes('(.pdf)')) return 'pdf';
    // Check "with CSS" before "(.md)" — its title contains both.
    if (title.includes('with CSS')) return 'md-css';
    if (title.includes('(.md)')) return 'md';
    if (title.includes('(.html)')) return 'html';
    if (title.includes('(.txt)')) return 'txt';
    if (title.includes('(.odt)')) return 'odt';
    return '';
  }, []);

  const formatOptionMap = useMemo(
    () =>
      exportOptions
        .filter((option): option is IEditorToolElement => option !== null)
        .reduce<Record<string, IEditorToolElement>>((acc, option) => {
          const format = getOptionFormat(option.title);
          if (format) {
            acc[format] = option;
          }
          return acc;
        }, {}),
    [exportOptions, getOptionFormat],
  );

  const formatSelectOptions = useMemo(
    () =>
      Object.entries(formatOptionMap)
        .filter(([, option]) => !option.disabled)
        .map(([id, option]) => ({
          id,
          label: option.title,
        })),
    [formatOptionMap],
  );

  const getTitle = useCallback(() => {
    if (!editor) return 'Untitled';
    const editorContent = editor.getJSON();
    return (
      extractTitleFromContent(
        editorContent as unknown as { content: JSONContent },
      ) || 'Untitled'
    );
  }, [editor]);

  const triggerSingleTabExport = useCallback(
    async (format: string, name?: string) => {
      const option = formatOptionMap[format];
      if (!option || option.disabled) return;
      option.onClick(name);
    },
    [formatOptionMap],
  );

  const createTempEditorForTab = useCallback(
    (tabId: string) => {
      if (!editor || !ydoc) return null;
      const fragment = ydoc.getXmlFragment(tabId);
      const tabContent = yXmlFragmentToProsemirrorJSON(fragment);

      return getTemporaryEditor(editor, tabContent as JSONContent);
    },
    [editor, ydoc],
  );

  const exportAllTabsAsPdf = useCallback(async () => {
    if (!editor || !ydoc || tabs.length === 0) return;
    const tempEditors: Editor[] = [];
    try {
      const allTabPages: string[] = [];

      for (const tab of tabs) {
        const tempEditor = createTempEditorForTab(tab.id);
        if (!tempEditor) continue;
        tempEditors.push(tempEditor);
        const tabTitle = normalizeTabTitle(tab.name);
        allTabPages.push(
          `<section class="tab-title-page"><h1 class="tab-title-page__text">${escapeHtml(tabTitle)}</h1></section>`,
        );
        allTabPages.push(tempEditor.getHTML());
      }

      const combinedHtml = allTabPages.join(
        '\n<div data-type="page-break" data-page-break="true"></div>\n',
      );

      handleContentPrint(combinedHtml);
    } finally {
      tempEditors.forEach((tempEditor) => tempEditor.destroy());
    }
  }, [
    createTempEditorForTab,
    editor,
    escapeHtml,
    normalizeTabTitle,
    tabs,
    ydoc,
  ]);

  const exportAllTabsAsMarkdown = useCallback(
    async (name?: string, includeStyles?: boolean) => {
      if (!editor || !ydoc || tabs.length === 0) return;
      const baseTitle = name || getTitle();
      const tempEditors: Editor[] = [];
      try {
        const allTabMd: string[] = [];

        for (const tab of tabs) {
          const tempEditor = createTempEditorForTab(tab.id);
          if (!tempEditor) continue;
          tempEditors.push(tempEditor);
          const tabTitle = normalizeTabTitle(tab.name);
          const markdown = await tempEditor.commands.exportMarkdownFile({
            title: tabTitle,
            returnMDFile: true,
            includeStyles,
          });
          const tabMarkdown = stripFrontmatter(markdown).trim();
          allTabMd.push(`# ${tabTitle}\n\n${tabMarkdown}`.trim());
        }

        const combinedMarkdown = allTabMd.join('\n\n');
        const blob = new Blob([combinedMarkdown], {
          type: 'text/markdown;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseTitle}.md`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } finally {
        tempEditors.forEach((tempEditor) => tempEditor.destroy());
      }
    },
    [createTempEditorForTab, editor, getTitle, normalizeTabTitle, tabs, ydoc],
  );

  const downloadAllTabsAsHtmlFile = useCallback(
    async (name?: string) => {
      if (!editor || !ydoc || tabs.length === 0) return;
      const baseTitle = name || getTitle();
      const tempEditors: Editor[] = [];
      try {
        const allTabHtml: string[] = [];

        for (const tab of tabs) {
          const tempEditor = createTempEditorForTab(tab.id);
          if (!tempEditor) continue;
          tempEditors.push(tempEditor);
          const tabTitle = normalizeTabTitle(tab.name);
          allTabHtml.push(
            `<h1>${escapeHtml(tabTitle)}</h1>\n${tempEditor.getHTML()}`,
          );
        }

        const combinedHtml = allTabHtml.join('\n');
        const htmlDocument = `<!DOCTYPE html><html><head><title>${baseTitle}</title></head><body>${combinedHtml}</body></html>`;
        const blob = new Blob([htmlDocument], {
          type: 'text/html;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseTitle}.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } finally {
        tempEditors.forEach((tempEditor) => tempEditor.destroy());
      }
    },
    [
      createTempEditorForTab,
      editor,
      escapeHtml,
      getTitle,
      normalizeTabTitle,
      tabs,
      ydoc,
    ],
  );

  const copyAllTabsAsAo3Html = useCallback(async () => {
    if (!editor || !ydoc || tabs.length === 0 || !copyAo3Html) return;

    await copyAo3Html(async () => {
      const tempEditors: Editor[] = [];
      try {
        const allTabHtml: string[] = [];

        for (const tab of tabs) {
          const tempEditor = createTempEditorForTab(tab.id);
          if (!tempEditor) continue;
          tempEditors.push(tempEditor);

          if (tempEditor.isEmpty) continue;

          const bodyHtml = await tempEditor.commands.exportHtmlContent();
          if (!bodyHtml?.trim()) continue;

          const tabTitle = normalizeTabTitle(tab.name);
          allTabHtml.push(`<h1>${escapeHtml(tabTitle)}</h1>\n${bodyHtml}`);
        }

        if (allTabHtml.length === 0) {
          throw new Error('HTML export returned no tab content');
        }

        return allTabHtml.join('\n');
      } finally {
        tempEditors.forEach((tempEditor) => tempEditor.destroy());
      }
    });
  }, [
    copyAo3Html,
    createTempEditorForTab,
    editor,
    escapeHtml,
    normalizeTabTitle,
    tabs,
    ydoc,
  ]);

  const exportAllTabsAsText = useCallback(
    async (name?: string) => {
      if (!editor || !ydoc || tabs.length === 0) return;
      const baseTitle = name || getTitle();
      const tempEditors: Editor[] = [];
      try {
        const allTabText: string[] = [];

        for (const tab of tabs) {
          const tempEditor = createTempEditorForTab(tab.id);
          if (!tempEditor) continue;
          tempEditors.push(tempEditor);
          const text = tempEditor
            .getText()
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          allTabText.push(text);
        }

        const combinedText = allTabText.join('\n\n===\n\n');
        const blob = new Blob([combinedText], {
          type: 'text/plain;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseTitle}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } finally {
        tempEditors.forEach((tempEditor) => tempEditor.destroy());
      }
    },
    [createTempEditorForTab, editor, getTitle, tabs, ydoc],
  );

  const exportAllTabsAsOdt = useCallback(
    async (name?: string) => {
      if (!editor || !ydoc || tabs.length === 0) return;
      const baseTitle = name || getTitle();
      const tempEditors: Editor[] = [];
      try {
        const allTabHtml: string[] = [];

        for (const tab of tabs) {
          const tempEditor = createTempEditorForTab(tab.id);
          if (!tempEditor) continue;
          tempEditors.push(tempEditor);
          const tabTitle = normalizeTabTitle(tab.name);
          allTabHtml.push(
            `<h1>${escapeHtml(tabTitle)}</h1>\n${tempEditor.getHTML()}`,
          );
        }

        const combinedHtml = allTabHtml.join('\n');
        const { html: cleanHtml } = preprocessHtml(combinedHtml);
        const odtBytes = await htmlToOdt(
          `<html><head><title>${baseTitle}</title></head><body>${cleanHtml}</body></html>`,
          { metadata: { title: baseTitle } },
        );
        const blob = new Blob([new Uint8Array(odtBytes)], {
          type: 'application/vnd.oasis.opendocument.text',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseTitle}.odt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } finally {
        tempEditors.forEach((tempEditor) => tempEditor.destroy());
      }
    },
    [
      createTempEditorForTab,
      editor,
      escapeHtml,
      getTitle,
      normalizeTabTitle,
      tabs,
      ydoc,
    ],
  );

  const runExport = useCallback(
    async ({
      format,
      tab,
      name,
    }: {
      format: string;
      tab: string;
      name?: string;
    }) => {
      if (!editor) return;
      const isAllTabs = tab === 'all';

      if (isAllTabs) {
        if (format === 'ao3-html') {
          await copyAllTabsAsAo3Html();
          return;
        }
        if (format === 'pdf') {
          await exportAllTabsAsPdf();
          return;
        }
        if (format === 'md') {
          await exportAllTabsAsMarkdown(name);
          return;
        }
        if (format === 'md-css') {
          await exportAllTabsAsMarkdown(name, true);
          return;
        }
        if (format === 'html') {
          await downloadAllTabsAsHtmlFile(name);
          return;
        }
        if (format === 'txt') {
          await exportAllTabsAsText(name);
          return;
        }
        if (format === 'odt') {
          await exportAllTabsAsOdt(name);
          return;
        }
        return;
      }

      await triggerSingleTabExport(format, name);
    },
    [
      editor,
      copyAllTabsAsAo3Html,
      downloadAllTabsAsHtmlFile,
      exportAllTabsAsMarkdown,
      exportAllTabsAsOdt,
      exportAllTabsAsPdf,
      exportAllTabsAsText,
      triggerSingleTabExport,
    ],
  );

  const handleExport = useCallback(
    ({ format, tab, name }: { format: string; tab: string; name?: string }) => {
      void runExport({ format, tab, name });
    },
    [runExport],
  );

  const handleExportAsync = useCallback(
    async ({
      format,
      tab,
      name,
    }: {
      format: string;
      tab: string;
      name?: string;
    }) => {
      await runExport({ format, tab, name });
    },
    [runExport],
  );

  return {
    getOptionFormat,
    formatSelectOptions,
    handleExport,
    handleExportAsync,
  };
};

export { useDdocExport };
