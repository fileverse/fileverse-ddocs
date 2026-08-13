import { useState } from 'react';
import {
  Button,
  DynamicDropdown,
  IconButton,
  LucideIcon,
} from '@fileverse/ui';
import { docStore } from '../storage/doc-store';
import { generateDocId } from '../utils';

interface DocSwitcherProps {
  currentDocId: string;
  currentTitle: string;
}

export function DocSwitcher({ currentDocId, currentTitle }: DocSwitcherProps) {
  const [docs] = useState(() => docStore.getDocList());

  const handleNewDoc = (schemaVersion?: 2) => {
    const newId = generateDocId();
    docStore.addDoc({
      id: newId,
      title: 'Untitled',
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
    });
    docStore.setCurrentDocId(newId);
    // v2 only matters at creation; once the doc is stamped, the marker rules.
    const v2Param = schemaVersion === 2 ? '&v2=1' : '';
    window.location.href = `${window.location.pathname}?doc=${newId}${v2Param}`;
  };

  const handleSwitchDoc = (docId: string) => {
    if (docId === currentDocId) return;
    docStore.setCurrentDocId(docId);
    window.location.href = `${window.location.pathname}?doc=${docId}`;
  };

  const handleDeleteDoc = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (docs.length <= 1) return;
    const doc = docs.find((d) => d.id === docId);
    const confirmed = window.confirm(
      `Delete document "${doc?.title || docId}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    docStore.removeDoc(docId);
    try {
      indexedDB.deleteDatabase(docId);
    } catch {
      // IndexedDB cleanup is best-effort
    }

    if (docId === currentDocId) {
      const remaining = docs.filter((d) => d.id !== docId);
      const next = remaining[0];
      if (next) {
        window.location.href = `${window.location.pathname}?doc=${next.id}`;
      }
    } else {
      window.location.reload();
    }
  };

  return (
    <DynamicDropdown
      key="doc-switcher"
      align="start"
      sideOffset={8}
      anchorTrigger={
        <Button
          variant="ghost"
          className="flex items-center gap-1 text-xs font-mono opacity-60 hover:opacity-100 transition-opacity max-w-[140px] !px-2"
        >
          <LucideIcon name="FileText" size="sm" />
          <span className="truncate">{currentTitle || 'Untitled'}</span>
          <LucideIcon name="ChevronDown" size="sm" />
        </Button>
      }
      content={
        <div className="flex flex-col gap-1 p-2 min-w-[240px] max-h-[300px] overflow-y-auto shadow-elevation-3">
          <div className="text-xs font-medium color-text-secondary px-2 py-1">
            Documents
          </div>
          {docs.map((doc) => (
            <div
              key={doc.id}
              className={`group flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer hover:color-bg-secondary transition-colors ${
                doc.id === currentDocId ? 'color-bg-secondary' : ''
              }`}
              onClick={() => handleSwitchDoc(doc.id)}
            >
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm truncate">
                  {doc.title || 'Untitled'}
                </span>
                <span className="text-[10px] font-mono color-text-secondary">
                  {doc.id.slice(0, 8)}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {doc.id === currentDocId && (
                  <LucideIcon
                    name="Check"
                    size="sm"
                    className="color-text-primary"
                  />
                )}
                {docs.length > 1 && (
                  <IconButton
                    variant="ghost"
                    icon="Trash2"
                    size="sm"
                    onClick={(e: React.MouseEvent) =>
                      handleDeleteDoc(doc.id, e)
                    }
                    className="opacity-0 group-hover:opacity-100"
                  />
                )}
              </div>
            </div>
          ))}
          <div className="border-t color-border-default my-1" />
          <Button
            variant="ghost"
            className="flex items-center gap-2 justify-start w-full"
            onClick={() => handleNewDoc()}
          >
            <LucideIcon name="Plus" size="sm" />
            New Document
          </Button>
          <Button
            variant="ghost"
            className="flex items-center gap-2 justify-start w-full"
            onClick={() => handleNewDoc(2)}
          >
            <LucideIcon name="FlaskConical" size="sm" />
            New Document (flat schema v2)
          </Button>
        </div>
      }
    />
  );
}
