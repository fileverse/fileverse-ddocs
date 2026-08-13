import { useEffect, useState } from 'react';
import { Button } from '@fileverse/ui';
import { docStore } from '../storage/doc-store';

interface DevBarProps {
  docId: string;
  activeTabId: string;
  tabCount: number;
  characterCount: number;
  pageCount: number;
  wordCount: number;
  collabStatus: string;
  lastSavedAt: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  return new Date(ts).toLocaleTimeString();
}

export function DevBar({
  docId,
  activeTabId,
  tabCount,
  characterCount,
  pageCount,
  wordCount,
  collabStatus,
  lastSavedAt,
}: DevBarProps) {
  const [visible, setVisible] = useState(false);
  const [contentSize, setContentSize] = useState(0);
  const [schemaInfo, setSchemaInfo] = useState('...');
  const [showJson, setShowJson] = useState(false);
  const [docJson, setDocJson] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 'd'
      ) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const update = () => setContentSize(docStore.getContentSize(docId));
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [visible, docId]);

  // Doc schema: what the marker says vs what the editor actually loaded.
  // A disagreement means the extension fork picked the wrong set.
  useEffect(() => {
    if (!visible) return;
    const update = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = (window as any).__ddoc?.current;
      const editor = handle?.getEditor?.();
      const ydoc = handle?.getYdoc?.();
      if (!editor || !ydoc) {
        setSchemaInfo('...');
        return;
      }
      const marker = ydoc.getMap('ddocMeta').get('schemaVersion');
      const markerVersion = typeof marker === 'number' ? marker : 1;
      const loadedVersion = editor.schema.nodes.dBlock ? 1 : 2;
      setSchemaInfo(
        markerVersion === loadedVersion
          ? `v${loadedVersion} ${loadedVersion >= 2 ? '(flat)' : '(dblock)'}`
          : `MISMATCH marker=v${markerVersion} loaded=v${loadedVersion}`,
      );
    };
    update();
    const interval = setInterval(update, 2000);
    return () => clearInterval(interval);
  }, [visible]);

  // Live document JSON while the panel is open.
  useEffect(() => {
    if (!visible || !showJson) return;
    const update = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = (window as any).__ddoc?.current?.getEditor?.();
      if (!editor) {
        setDocJson('editor not ready');
        return;
      }
      setDocJson(JSON.stringify(editor.getJSON(), null, 2));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [visible, showJson]);

  const handleCopyJson = () => {
    navigator.clipboard?.writeText(docJson);
  };

  const handleClearData = () => {
    const confirmed = window.confirm(
      'Clear all data for this document? (localStorage + IndexedDB)',
    );
    if (!confirmed) return;
    docStore.clearContent(docId);
    try {
      indexedDB.deleteDatabase(docId);
    } catch (e) {
      console.warn('Failed to delete IndexedDB:', e);
    }
    window.location.reload();
  };

  if (!visible) return null;

  const Separator = () => (
    <span className="w-px h-4 bg-neutral-300 dark:bg-neutral-600" />
  );

  return (
    <>
      {showJson && (
        <div className="fixed bottom-8 right-0 z-[9999] w-[480px] max-w-[90vw] h-[60vh] color-bg-default border color-border-default rounded-tl-md shadow-lg flex flex-col">
          <div className="flex items-center justify-between px-3 py-1 border-b color-border-default">
            <span className="text-[11px] font-mono color-text-secondary">
              editor.getJSON() (live)
            </span>
            <Button
              variant="ghost"
              className="!h-5 !text-[10px] !px-2"
              onClick={handleCopyJson}
            >
              Copy
            </Button>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono color-text-secondary whitespace-pre">
            {docJson}
          </pre>
        </div>
      )}
      <div className="fixed bottom-0 left-0 right-0 z-[9999] h-8 color-bg-default border-t color-border-default flex items-center gap-3 px-4 text-[11px] font-mono color-text-secondary select-none">
      <span title="Document ID">
        <strong>doc:</strong> {docId.slice(0, 8)}
      </span>
      <Separator />
      <span
        title="Doc schema: marker in ddocMeta vs extensions the editor loaded"
        className={
          schemaInfo.startsWith('MISMATCH') ? 'text-red-500 font-bold' : ''
        }
      >
        <strong>schema:</strong> {schemaInfo}
      </span>
      <Separator />
      <span title="Active Tab ID">
        <strong>tab:</strong> {activeTabId}
      </span>
      <Separator />
      <span title="Number of tabs">
        <strong>tabs:</strong> {tabCount}
      </span>
      <Separator />
      <span title="Character count">
        <strong>chars:</strong> {characterCount.toLocaleString()}
      </span>
      <Separator />
      <span title="Character count">
        <strong>page:</strong> {pageCount.toLocaleString()}
      </span>
      <Separator />
      <span title="Word count">
        <strong>words:</strong> {wordCount.toLocaleString()}
      </span>
      <Separator />
      <span title="Stored content size">
        <strong>size:</strong> {formatBytes(contentSize)}
      </span>
      <Separator />
      <span title="Collaboration status">
        <strong>collab:</strong>{' '}
        <span
          className={
            collabStatus === 'ready'
              ? 'text-green-500'
              : collabStatus === 'reconnecting'
                ? 'text-yellow-500'
                : collabStatus === 'error'
                  ? 'text-red-500'
                  : collabStatus === 'connecting' ||
                      collabStatus === 'syncing' ||
                      collabStatus === 'merging'
                    ? 'text-blue-500'
                    : ''
          }
        >
          {collabStatus}
        </span>
      </span>
      <Separator />
      <span title="Last saved to localStorage">
        <strong>saved:</strong> {formatTime(lastSavedAt)}
      </span>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          className="!h-5 !text-[10px] !px-2"
          onClick={() => setShowJson((v) => !v)}
        >
          {showJson ? 'Hide JSON' : 'JSON'}
        </Button>
        <Button
          variant="ghost"
          className="!h-5 !text-[10px] !px-2 text-red-500"
          onClick={handleClearData}
        >
          Clear Data
        </Button>
        <span className="opacity-50">Ctrl+Shift+D to hide</span>
      </div>
    </div>
    </>
  );
}
