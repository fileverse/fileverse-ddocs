import { useState } from 'react';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { Tab } from './tabs/utils/tab-utils';
import { useEditorToolbar } from './editor-utils';
import { ImportExportButton } from './import-export-button';
import { DdocProps } from '../types';

interface PreviewModeExportTriggerProps {
  editor: Editor | null;
  ydoc: Y.Doc;
  tabs: Tab[];
  onRegisterExportTrigger?: (
    trigger: ((format?: string, name?: string) => void) | null,
  ) => void;
  onError?: (errorString: string) => void;
  ipfsImageUploadFn?: DdocProps['ipfsImageUploadFn'];
  onMarkdownExport?: DdocProps['onMarkdownExport'];
  onMarkdownImport?: DdocProps['onMarkdownImport'];
  onPdfExport?: DdocProps['onPdfExport'];
  onHtmlExport?: DdocProps['onHtmlExport'];
  onTxtExport?: DdocProps['onTxtExport'];
  onOdtExport?: DdocProps['onOdtExport'];
  ipfsImageFetchFn?: DdocProps['ipfsImageFetchFn'];
  onDocxImport?: DdocProps['onDocxImport'];
  fetchV1ImageFn?: DdocProps['fetchV1ImageFn'];
  isConnected?: DdocProps['isConnected'];
}

const PreviewModeExportTrigger = ({
  editor,
  ydoc,
  tabs,
  onRegisterExportTrigger,
  onError,
  ipfsImageUploadFn,
  onMarkdownExport,
  onMarkdownImport,
  onPdfExport,
  onHtmlExport,
  onTxtExport,
  onOdtExport,
  ipfsImageFetchFn,
  onDocxImport,
  fetchV1ImageFn,
  isConnected,
}: PreviewModeExportTriggerProps) => {
  const [fileExportsOpen, setFileExportsOpen] = useState(false);

  const { exportOptions, copyAo3Html } = useEditorToolbar({
    editor,
    onError,
    ipfsImageUploadFn,
    onMarkdownExport,
    onMarkdownImport,
    onPdfExport,
    onHtmlExport,
    onTxtExport,
    onOdtExport,
    ipfsImageFetchFn,
    onDocxImport,
    fetchV1ImageFn,
    isConnected,
  });

  return (
    <div className="hidden">
      <ImportExportButton
        fileExportsOpen={fileExportsOpen}
        setFileExportsOpen={setFileExportsOpen}
        exportOptions={exportOptions}
        importOptions={[]}
        editor={editor}
        tabs={tabs}
        ydoc={ydoc}
        copyAo3Html={copyAo3Html}
        onRegisterExportTrigger={onRegisterExportTrigger}
      />
    </div>
  );
};

export { PreviewModeExportTrigger };
