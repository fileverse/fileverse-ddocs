import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import DdocEditor from '../../package/ddoc-editor';
import type { FontDescriptor } from '../../package/types';
import { Editor, JSONContent } from '@tiptap/react';
import { SecondLevelNav } from './components/second-level-nav/second-level-nav';
import { demoMenuTree } from './components/second-level-nav/menu-tree';
import { deriveCapabilities } from './components/second-level-nav/capabilities';
import { createDemoAppActions } from './components/second-level-nav/demo-app-actions';
import { WordCountModal } from './components/WordCountModal';
import { DemoFooter } from './components/DemoFooter';

const demoFonts: FontDescriptor[] = [
  {
    name: 'Poppins',
    family: 'Poppins, sans-serif',
    url: 'https://fonts.gstatic.com/s/poppins/v22/pxiEyp8kv8JHgFVrJJfecnFHGPc.woff2',
  },
  {
    name: 'Inter',
    family: 'Inter, sans-serif',
    url: 'https://fonts.gstatic.com/s/inter/v20/UcCo3FwrK3iLTcviYwYZ8UA3.woff2',
  },
];
import {
  Button,
  Tag,
  IconButton,
  LucideIcon,
  toast,
  Toaster,
  TagType,
  DynamicDropdown,
  ThemeToggle,
} from '@fileverse/ui';
import { useMediaQuery } from 'usehooks-ts';
import { IComment } from '../../package/extensions/comment';
import { fromUint8Array } from 'js-base64';
import { crypto as cryptoUtils } from './crypto';
import { collabStore } from './storage/collab-store';
import { docStore } from './storage/doc-store';
import { swarmEnabled, useSwarmStorage } from './storage/swarm-store';
import {
  MAX_RESTORE_ATTEMPTS,
  restoreRetryDelayMs,
} from './storage/restore-retry';
import { SwarmRestoreProgress } from './components/SwarmRestoreProgress';
import { SwarmNotice } from './components/SwarmNotice';
import { primarySwarmCondition } from '../../package/utils/swarm-diagnostics';
import type { DocumentVersion } from '../../package/utils/swarm-document-storage';
import {
  deleteDdocContent,
  getDdocContentFingerprint,
  mergeDdocContent,
  readDdocContent,
  repairDdocContent,
} from '../../package/persistence';
import { DocumentStylingPanel } from './DocumentStylingPanel';
import { PAGES_FIXTURES } from './fixtures/pages';
import { PagesPanel } from './pages/PagesPanel';
import { installPagesDebug, waitForLayout } from './pages/pages-debug';
import {
  DocumentStyling,
  PageSetup,
  CollaborationProps,
  CollabState,
  SerializedCommentAnchor,
  CommentMutationMeta,
} from '../../package/types';
import {
  getKeyFromURLParams,
  generateDocId,
  getDocIdFromURL,
  getTabIdFromURL,
  setURLParams,
  buildDocTabURL,
} from './utils';
import { DevBar } from './components/DevBar';
import { DocSwitcher } from './components/DocSwitcher';

/**
 * Swarm snapshot envelope: carries the document title alongside the content
 * (the base64 Yjs state the store holds), so a restore in another browser
 * recovers both. Older raw-content snapshots (no envelope) still load.
 */
const packSnapshot = (title: string, content: string): string =>
  JSON.stringify({ __ddoc: 1, title, content });
const unpackSnapshot = (text: string): { title?: string; content: string } => {
  try {
    const v = JSON.parse(text);
    if (v && v.__ddoc === 1 && typeof v.content === 'string') return v;
  } catch {
    // not an envelope: fall through
  }
  return { content: text };
};

/** Keep ?swarmVersion=N in the address bar (shareable) without reloading. */
const syncVersionParam = (n: number | null) => {
  const url = new URL(window.location.href);
  if (n === null) url.searchParams.delete('swarmVersion');
  else url.searchParams.set('swarmVersion', String(n));
  window.history.replaceState(null, '', url.toString());
};

/** The Swarm mark (ethswarm.org), drawn in the current text color. */
const SwarmIcon = () => (
  <svg
    viewBox="0 0 1115 1115"
    width="12"
    height="12"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M0 665.01V965l260 150 260-150.01V664.96L260 515 0 665.01zM855 515 595 665v299.99L855 1115l260-150.01V664.95L855 515zM817.32 300.27l-129.91-75.25-.13-149.98L557.5 0 297.68 150.01V450L557.5 600l259.82-150V300.27z" />
    <path d="m817.32 300.27 129.91-75.3V75L817.52 0 687.28 75.04l130.24 74.83-.2 150.4z" />
  </svg>
);

type VersionPreview = {
  index: number;
  /** The version's base64 Yjs state, handed to versionHistoryState. */
  content: string;
  /** Full snapshot envelope, re-saved verbatim on restore. */
  raw: string;
  title?: string;
};

function App() {
  // --- Document identity ---
  const [docId] = useState<string>(() => {
    const urlDocId = getDocIdFromURL();
    if (urlDocId) {
      const list = docStore.getDocList();
      if (!list.find((d) => d.id === urlDocId)) {
        docStore.addDoc({
          id: urlDocId,
          title: 'Untitled',
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        });
      }
      docStore.setCurrentDocId(urlDocId);
      return urlDocId;
    }

    const storedDocId = docStore.getCurrentDocId();
    if (storedDocId) {
      setURLParams({ doc: storedDocId });
      return storedDocId;
    }

    const newId = generateDocId();
    docStore.addDoc({
      id: newId,
      title: 'Untitled',
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
    });
    docStore.setCurrentDocId(newId);
    setURLParams({ doc: newId });
    return newId;
  });

  const urlTabId = getTabIdFromURL();

  // --- Swarm storage (images and document versions) ---
  // Active when VITE_BEE_API_URL is set or the browser injects window.swarm
  // (see storage/swarm-store.ts). Documents go to Swarm only in the default
  // store mode: each save reads the doc's y-indexeddb store and uploads it
  // as a new version on the doc's feed.
  const {
    imageUploadFn,
    imageFetchFn,
    docStorage,
    stampHealth,
    nodeState,
    canWrite,
    progress: swarmProgress,
    adoptBatch,
    beeUrl: swarmBeeUrl,
    batchId: swarmBatchId,
    diagnosticsInput,
    recheck: recheckSwarm,
    grantAccess: grantSwarmAccess,
    markDocumentReadOnly,
    managesPostage: swarmManagesPostage,
    documentHasOwnKey,
    documentKeyFromLink,
  } = useSwarmStorage(docId);
  // Bumped to read the store again (after a Swarm restore, or after leaving
  // a version preview) before the editor mounts.
  const [storeEpoch, setStoreEpoch] = useState(0);
  // Assigned below, once its dependencies exist; the handlers declared
  // before it call it through this ref.
  const scheduleSwarmSaveRef = useRef<() => void>(() => {});

  const isOwnerEdSecretSet = import.meta.env.VITE_OWNER_ED_SECRET;
  // --- Persistence ---
  // Use undefined (not null) when no saved content — null has special meaning
  // in use-tab-editor.tsx (it signals "content explicitly not ready yet")
  const [initialContent] = useState<string | undefined>(
    () => docStore.getContent(docId) || undefined,
  );
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (
      updatedDocContent: string | JSONContent,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _updateChunk: string,
    ) => {
      if (typeof updatedDocContent === 'string') {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          docStore.setContent(docId, updatedDocContent);
          setLastSavedAt(Date.now());
        }, 100);
      }
    },
    [docId],
  );

  // --- Where the doc is kept ---
  // By default the demo works like ddocs.new: the doc lives only in the
  // package's y-indexeddb store. It reads the store before mounting the
  // editor (the editor waits while initialContent is null) and passes what
  // the store holds as initialContent, with isNewDocument false so the editor
  // does not take it for a new doc. It saves nothing itself (onLocalChange,
  // no onChange) and shows store errors.
  // The stored body must be passed: left to load the store by itself, the
  // editor builds before the store loads, cannot see the doc's schema marker,
  // and binding a schema-2 doc with the schema-1 editor deletes its text from
  // the store. A store that cannot be read keeps the editor waiting.
  // `?localCopy=1` keeps the older host behaviour instead: a localStorage copy
  // saved through onChange and passed back as initialContent.
  const storeOnly = useMemo(
    () => new URLSearchParams(window.location.search).get('localCopy') !== '1',
    [],
  );
  const [storeCheck, setStoreCheck] = useState<
    | { status: 'pending' | 'new' | 'unreadable' }
    | { status: 'existing'; content: string }
  >({ status: 'pending' });
  useEffect(() => {
    if (!storeOnly) return;
    let cancelled = false;
    setStoreCheck({ status: 'pending' });
    void (async () => {
      let stored = await readDdocContent(docId);
      if (stored.status === 'corrupt') {
        await repairDdocContent(docId);
        stored = await readDdocContent(docId);
      }
      if (cancelled) return;
      if (stored.status === 'available' && stored.encodedState) {
        setStoreCheck({ status: 'existing', content: stored.encodedState });
      } else if (stored.status === 'missing' || stored.status === 'empty') {
        setStoreCheck({ status: 'new' });
      } else {
        console.error('[demo] could not read the store:', stored.status);
        toast({
          title: "Couldn't read this doc's store",
          description: `Status: ${stored.status}. Reload to try again.`,
          variant: 'error',
          iconType: 'icon',
        });
        setStoreCheck({ status: 'unreadable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeOnly, docId, storeEpoch]);
  // Read the store again before the editor (re)mounts. The check goes back
  // to pending in the same render, so the editor waits instead of mounting
  // on the previous read: on stale content it would write that back into
  // the store, and on a stale "new" it would stamp an existing doc as new.
  const rereadStore = useCallback(() => {
    setStoreCheck({ status: 'pending' });
    setStoreEpoch((e) => e + 1);
  }, []);
  const handleLocalChange = useCallback(() => {
    setLastSavedAt(Date.now());
    scheduleSwarmSaveRef.current();
  }, []);
  // True while "Restore as latest" replaces this doc's store (see below).
  const replacingStoreRef = useRef(false);
  const handleIndexedDbError = useCallback((error: Error) => {
    // An editor that was mounted earlier keeps its connection to the store
    // and reports the store's deletion as a lost connection. During a
    // restore that deletion is this page's own doing, not a save problem.
    if (replacingStoreRef.current) return;
    console.error('[demo] local save problem:', error);
    toast({
      title: 'Local save problem',
      description: error.message,
      variant: 'error',
      iconType: 'icon',
    });
  }, []);

  // --- Tab deep linking ---
  const handleCopyTabLink = useCallback(
    (tabId: string) => {
      const url = buildDocTabURL(docId, tabId);
      navigator.clipboard.writeText(url).then(() => {
        toast({
          title: 'Tab link copied to clipboard',
          variant: 'success',
          toastType: 'mini',
          iconType: 'icon',
        });
      });
    },
    [docId],
  );

  const tabConfig = useMemo(
    () => ({
      defaultTabId: urlTabId,
      onCopyTabLink: handleCopyTabLink,
      enableSubtabs: true,
    }),
    [urlTabId, handleCopyTabLink],
  );

  // --- Dev bar state ---
  const [activeTabInfo, setActiveTabInfo] = useState({
    activeTabId: 'default',
    tabCount: 0,
  });

  const [collabEnabled, setCollabEnabled] = useState(false);
  const [collabStatus, setCollabStatus] = useState<string>('off');
  const [username, setUsername] = useState('username');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isMediaMax1280px = useMediaQuery('(max-width: 1280px)');
  const [selectedTags, setSelectedTags] = useState<TagType[]>([]);
  const [isCommentSectionOpen, setIsCommentSectionOpen] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [showTOC, setShowTOC] = useState<boolean>(true);
  const [collaborationId, setCollaborationId] = useState<string>('');
  const [collabRoomKey, setCollabRoomKey] = useState<string>('');

  const [characterCount, setCharacterCount] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [wordCountModalOpen, setWordCountModalOpen] = useState(false);

  // --- Title with persistence ---
  const [title, setTitle] = useState(() => {
    const list = docStore.getDocList();
    const doc = list.find((d) => d.id === docId);
    return doc?.title || 'Untitled';
  });

  // Latest title for Swarm envelopes (a title edit fires no content change).
  const titleRef = useRef(title);
  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      docStore.updateDocTitle(docId, newTitle);
      titleRef.current = newTitle;
      // A title edit is a document change too: version it on Swarm.
      scheduleSwarmSaveRef.current();
    },
    [docId],
  );

  // --- Swarm: status, restore, saves, version history ---
  const [swarmStatus, setSwarmStatus] = useState<
    | { state: 'off' }
    // Looked up, and the doc has no version on Swarm.
    | { state: 'none' }
    | { state: 'saving' }
    | { state: 'saved'; version: number }
    | { state: 'error'; message: string }
  >({ state: 'off' });
  // What (if anything) is wrong with Swarm right now, in the user's terms.
  const swarmCondition = swarmEnabled
    ? primarySwarmCondition({
        ...diagnosticsInput,
        // Opened from someone else's link: its feed can only be signed by
        // its owner, so publishing obstacles are not this reader's to fix.
        documentReadOnly: documentHasOwnKey && swarmManagesPostage,
        lastError:
          swarmStatus.state === 'error' ? swarmStatus.message : undefined,
      })
    : null;

  // Restore. A doc this browser's store does not hold (opened from a link,
  // or in another browser) is restored from its latest Swarm version: the
  // snapshot is merged into the store, which is then read again, and the
  // editor mounts from the store as usual. Until that settles the restore
  // screen stands in for the editor, so nothing mounts the doc as new.
  const [swarmRestore, setSwarmRestore] = useState<'idle' | 'running' | 'done'>(
    'idle',
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [restoreDeferred, setRestoreDeferred] = useState(false);
  // The attempt in which the browser refused this page an identity. It is
  // not asked again until the user does: "Try again" starts a new attempt.
  const identityRefusedAtRef = useRef<number | null>(null);
  const swarmRestoreGate =
    swarmEnabled &&
    storeOnly &&
    storeCheck.status === 'new' &&
    swarmRestore !== 'done';
  useEffect(() => {
    if (swarmRestoreGate && swarmRestore === 'idle') setSwarmRestore('running');
  }, [swarmRestoreGate, swarmRestore]);
  useEffect(() => {
    if (swarmRestore !== 'running') return;
    // The node answered but has no batch: reads still work, so carry on.
    // Only a node we cannot reach at all ends the restore early.
    if (nodeState.kind === 'unreachable') {
      setRestoreError(nodeState.reason || 'Bee node unreachable');
      return;
    }
    // A provider reveals this app's feed identity only once the user has
    // granted access, so a doc whose owner must come from the provider
    // cannot even be looked up before that. Open it and let the notice ask;
    // the effect below restores it if access is granted while it is empty.
    if (
      diagnosticsInput.provider?.reason === 'not-connected' &&
      !documentHasOwnKey
    ) {
      setRestoreDeferred(true);
      setSwarmRestore('done');
      return;
    }
    if (!docStorage) return;
    if (identityRefusedAtRef.current === restoreAttempt) return;
    let cancelled = false;
    void (async () => {
      try {
        setRestoreError(null);
        // Under a provider, a doc made here lives on the feed of the
        // identity the browser signs this page's feeds with, and the
        // browser names it only with the user's leave (and only once they
        // have set one up). A refusal is the user's answer, not a node
        // still warming up: say what is missing and wait for them, rather
        // than ask five times in a row.
        if (swarmManagesPostage && !documentHasOwnKey) {
          try {
            await docStorage.feedOwner();
          } catch (error) {
            if (cancelled) return;
            console.warn('Swarm identity not available', error);
            identityRefusedAtRef.current = restoreAttempt;
            setRestoreError(
              `your browser did not give this page a Swarm identity (${(error as Error).message}). Set up or unlock your identity in the browser and allow the request, then try again`,
            );
            return;
          }
          if (cancelled) return;
        }
        const snapshot = await docStorage.loadDocument(docId);
        if (cancelled) return;
        if (snapshot) {
          const { title: restoredTitle, content } = unpackSnapshot(
            snapshot.text,
          );
          const merged = await mergeDdocContent(docId, content);
          if (cancelled) return;
          if (merged.status !== 'available') {
            throw new Error(
              `Could not write the restored version into this browser's store (${merged.status})`,
            );
          }
          lastSavedRef.current = {
            fingerprint: await getDdocContentFingerprint(content),
            title: restoredTitle ?? titleRef.current,
          };
          if (restoredTitle) {
            setTitle(restoredTitle);
            titleRef.current = restoredTitle;
            docStore.updateDocTitle(docId, restoredTitle);
          }
          setSwarmStatus({ state: 'saved', version: snapshot.feedIndex });
          console.info(
            `Swarm: restored document version ${snapshot.feedIndex}`,
          );
          rereadStore();
        } else if (documentKeyFromLink) {
          // The link names a doc this browser has never held, and nothing
          // is saved under the identity looked up here: it was made under
          // another browser's identity, which such a link does not name.
          // Say so, rather than open an empty doc in its place.
          setRestoreError(
            'this link was made in a browser that keeps the document under its own Swarm identity, so the document can only be opened there',
          );
          return;
        } else {
          setSwarmStatus({ state: 'none' });
        }
        if (!cancelled) setSwarmRestore('done');
      } catch (error) {
        console.warn('Swarm restore failed', error);
        if (cancelled) return;
        // Keep the restore screen up rather than dropping into an empty
        // editor that silently discards a doc still out there. Early
        // failures are usually a node that is not ready yet, so retry a
        // bounded number of times before asking the reader to.
        if (restoreAttempt + 1 < MAX_RESTORE_ATTEMPTS) {
          const delay = restoreRetryDelayMs(restoreAttempt);
          setTimeout(() => setRestoreAttempt((n) => n + 1), delay);
        } else {
          setRestoreError((error as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    swarmRestore,
    docStorage,
    docId,
    nodeState,
    restoreAttempt,
    diagnosticsInput.provider?.reason,
    documentHasOwnKey,
    documentKeyFromLink,
    swarmManagesPostage,
    rereadStore,
  ]);
  // Access granted after a deferred restore: try again, but only while the
  // store still holds nothing, so nothing typed meanwhile is overwritten.
  useEffect(() => {
    if (
      !restoreDeferred ||
      !diagnosticsInput.provider ||
      diagnosticsInput.provider.reason === 'not-connected'
    ) {
      return;
    }
    setRestoreDeferred(false);
    void readDdocContent(docId).then((stored) => {
      if (stored.status === 'missing' || stored.status === 'empty') {
        setRestoreAttempt(0);
        setSwarmRestore('running');
      }
    });
  }, [restoreDeferred, diagnosticsInput.provider, docId]);

  // Saves. Each (debounced) save reads the store and uploads it as a new
  // version, skipped when neither the content nor the title changed since
  // the version last saved or restored. While Swarm cannot be written (no
  // batch, node stopped) the save is held and flushed when it can.
  const lastSavedRef = useRef<{ fingerprint: string; title: string } | null>(
    null,
  );
  const swarmSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const swarmSavePendingRef = useRef(false);
  const [versionPreview, setVersionPreview] = useState<VersionPreview | null>(
    null,
  );
  const scheduleSwarmSave = useCallback(() => {
    if (!docStorage || !storeOnly) return;
    swarmSavePendingRef.current = true;
    if (versionPreview || !canWrite) return;
    if (swarmSaveTimeoutRef.current) clearTimeout(swarmSaveTimeoutRef.current);
    swarmSaveTimeoutRef.current = setTimeout(async () => {
      swarmSavePendingRef.current = false;
      const stored = await readDdocContent(docId);
      if (!stored.encodedState) return;
      const title = titleRef.current;
      const fingerprint = await getDdocContentFingerprint(stored.encodedState);
      const last = lastSavedRef.current;
      if (last && last.fingerprint === fingerprint && last.title === title) {
        return;
      }
      setSwarmStatus({ state: 'saving' });
      try {
        const version = await docStorage.saveDocument(
          docId,
          packSnapshot(title, stored.encodedState),
        );
        lastSavedRef.current = { fingerprint, title };
        setSwarmStatus({ state: 'saved', version: version.index });
      } catch (error) {
        console.error('Swarm save failed', error);
        swarmSavePendingRef.current = true;
        // A doc owned by another identity cannot be written here; record
        // that so nothing else is attempted and the tag says so.
        if (/read-only here|another identity/i.test((error as Error).message)) {
          markDocumentReadOnly();
        } else {
          setSwarmStatus({ state: 'error', message: (error as Error).message });
        }
      }
    }, 2000);
  }, [
    docId,
    docStorage,
    storeOnly,
    versionPreview,
    canWrite,
    markDocumentReadOnly,
  ]);
  scheduleSwarmSaveRef.current = scheduleSwarmSave;
  // Swarm writable again (a batch bought, a node back): flush what waited.
  useEffect(() => {
    if (canWrite && swarmSavePendingRef.current) scheduleSwarmSave();
  }, [canWrite, scheduleSwarmSave]);

  // Version history, through the package's versionHistoryState: selecting
  // a version re-hydrates the mounted editor in place, and the package
  // suspends its own persistence while version mode is on. ?swarmVersion=N
  // deep-links to a version.
  const [editorEpoch, setEditorEpoch] = useState(0);
  const pendingVersionParamRef = useRef<number | null>(
    (() => {
      const v = new URLSearchParams(window.location.search).get('swarmVersion');
      return v === null ? null : Number(v);
    })(),
  );
  const [versionList, setVersionList] = useState<DocumentVersion[] | null>(
    null,
  );
  const [versionListError, setVersionListError] = useState<string | null>(
    null,
  );
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Rendered in a portal at a fixed position so no toolbar or navbar
  // stacking context can cover it.
  const [versionMenuPos, setVersionMenuPos] = useState({ top: 0, left: 0 });
  const swarmTagRef = useRef<HTMLButtonElement | null>(null);
  const openVersionHistory = useCallback(async () => {
    if (!docStorage) return;
    const rect = swarmTagRef.current?.getBoundingClientRect();
    setVersionMenuPos(
      rect
        ? { top: rect.bottom + 4, left: rect.left }
        : { top: 56, left: window.innerWidth / 2 - 120 },
    );
    setVersionsOpen((open) => !open);
    setVersionListError(null);
    try {
      setVersionList(await docStorage.listDocumentVersions(docId));
    } catch (error) {
      console.warn('Swarm version list failed', error);
      setVersionList([]);
      setVersionListError((error as Error).message);
    }
  }, [docStorage, docId]);
  const previewVersion = useCallback(
    async (index: number) => {
      if (!docStorage) return;
      try {
        const snapshot = await docStorage.loadDocumentVersion(docId, index);
        if (!snapshot) return;
        const { title: vTitle, content } = unpackSnapshot(snapshot.text);
        setVersionPreview({
          index,
          content,
          raw: snapshot.text,
          title: vTitle,
        });
        syncVersionParam(index);
      } catch (error) {
        console.warn('Swarm version load failed', error);
      }
    },
    [docStorage, docId],
  );
  const exitVersionPreview = useCallback(() => {
    setVersionPreview(null);
    syncVersionParam(null);
    // A fresh live session, mounted from what the store holds now.
    setEditorEpoch((e) => e + 1);
    rereadStore();
  }, [rereadStore]);
  // Restore as latest: history is never rewritten; the version is saved
  // again as the newest one and becomes the doc's content here. A merge
  // cannot undo newer edits, so the store is replaced: the editor unmounts,
  // the store is deleted and refilled with the version, and a fresh session
  // mounts from it.
  const [restoringVersion, setRestoringVersion] =
    useState<VersionPreview | null>(null);
  useEffect(() => {
    if (!restoringVersion || !docStorage) return;
    let cancelled = false;
    void (async () => {
      const version = restoringVersion;
      try {
        replacingStoreRef.current = true;
        const deleted = await deleteDdocContent(docId).finally(() => {
          replacingStoreRef.current = false;
        });
        // Still open somewhere else (another tab): merging into it would
        // keep the newer edits this restore is meant to drop.
        if (deleted.status !== 'deleted') {
          throw new Error(
            `Could not replace this browser's copy of the document (${deleted.status}). Close other tabs that have it open and try again.`,
          );
        }
        const merged = await mergeDdocContent(docId, version.content);
        if (merged.status !== 'available') {
          throw new Error(
            `Could not write the version into this browser's store (${merged.status})`,
          );
        }
        const saved = await docStorage.saveDocument(docId, version.raw);
        const title = version.title ?? titleRef.current;
        lastSavedRef.current = {
          fingerprint: await getDdocContentFingerprint(version.content),
          title,
        };
        if (version.title) {
          setTitle(version.title);
          titleRef.current = version.title;
          docStore.updateDocTitle(docId, version.title);
        }
        setSwarmStatus({ state: 'saved', version: saved.index });
      } catch (error) {
        console.error('Swarm restore failed', error);
        setSwarmStatus({ state: 'error', message: (error as Error).message });
      }
      if (cancelled) return;
      setVersionList(null);
      setRestoringVersion(null);
      exitVersionPreview();
    })();
    return () => {
      cancelled = true;
    };
  }, [restoringVersion, docStorage, docId, exitVersionPreview]);
  // ?swarmVersion=N deep link: enter version preview once the doc is open.
  useEffect(() => {
    const pending = pendingVersionParamRef.current;
    if (pending !== null && docStorage && !swarmRestoreGate) {
      pendingVersionParamRef.current = null;
      void previewVersion(pending);
    }
  }, [docStorage, swarmRestoreGate, previewVersion]);

  // Document styling state - starts undefined to allow dark mode to work.
  // ?pagesFixture=<id>&paper=a4|letter&orientation=landscape opens a Pages M0
  // fixture (docs/PAGES_MODE.md §6); &mode=pageless opens it in Pageless.
  const [documentStyling, setDocumentStyling] = useState<
    DocumentStyling | undefined
  >(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('pagesFixture')) return undefined;
    return {
      pageSetup: {
        mode: params.get('mode') === 'pageless' ? 'pageless' : 'pages',
        paper: params.get('paper') === 'letter' ? 'letter' : 'a4',
      },
      orientation:
        params.get('orientation') === 'landscape' ? 'landscape' : 'portrait',
    };
  });
  const [showStylingControls, setShowStylingControls] = useState(false);
  // null toggles. Keeps the paper size the document already has.
  const setPageMode = useCallback((mode: PageSetup['mode'] | null) => {
    setDocumentStyling((prev) => {
      const current = prev?.pageSetup?.mode ?? 'pageless';
      return {
        ...(prev ?? {}),
        pageSetup: {
          paper: prev?.pageSetup?.paper ?? 'a4',
          mode: mode ?? (current === 'pages' ? 'pageless' : 'pages'),
        },
      };
    });
  }, []);

  const [inlineCommentData, setInlineCommentData] = useState({
    inlineCommentText: '',
    highlightedTextContent: '',
    handleClick: false,
  });

  const [zoomLevel, setZoomLevel] = useState<string>('1');
  const [isNavbarVisible, setIsNavbarVisible] = useState(true);
  const [navbarHost, setNavbarHost] = useState<HTMLElement | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  // Controlled focus mode (D6) — the second-level nav's View menu drives it.
  const [isFocusMode, setIsFocusMode] = useState(false);
  const isOnline = useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
  const [disableInlineComment, setDisableInlineComment] = useState(false);
  const [isDDocOwner, setIsDDocOwner] = useState(true);
  const [viewerMode, setViewerMode] = useState<
    'suggest' | 'view-only' | undefined
  >(undefined);

  // Single mode picker for the demo navbar — cycles
  // Owner → Viewer/Suggest → Viewer/View-only → Owner.
  const cycleMode = () => {
    if (isDDocOwner) {
      setIsDDocOwner(false);
      setIsPreviewMode(true);
      setViewerMode('suggest');
    } else if (viewerMode === 'suggest') {
      setViewerMode('view-only');
    } else {
      setIsDDocOwner(true);
      setIsPreviewMode(false);
      setViewerMode(undefined);
    }
  };
  const modeIcon = isDDocOwner
    ? 'Crown'
    : viewerMode === 'suggest'
      ? 'PenLine'
      : 'Eye';
  const modeLabel = isDDocOwner
    ? 'Owner'
    : viewerMode === 'suggest'
      ? 'Suggest'
      : 'View-only';
  const nextModeLabel = isDDocOwner
    ? 'Suggest'
    : viewerMode === 'suggest'
      ? 'View-only'
      : 'Owner';
  const [initialCommentAnchors, setInitialCommentAnchors] = useState<
    SerializedCommentAnchor[]
  >([]);

  const searchParams = new URLSearchParams(window.location.search);
  const paramCollaborationId = searchParams.get('collaborationId');
  const paramKey = getKeyFromURLParams(searchParams);
  const [collabIsOwner, setCollabIsOwner] = useState(false);
  const [collabExtras, setCollabExtras] = useState<{
    ownerEdSecret?: string;
    contractAddress?: string;
    ownerAddress?: string;
    isEns?: boolean;
  }>({});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  // Dev affordance: expose the editor handle for automated smoke tests.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ddoc = editorRef;
  }, []);

  const documentStylingRef = useRef(documentStyling);
  documentStylingRef.current = documentStyling;
  const pagesDeps = useMemo(
    () => ({
      getEditor: () => editorRef.current?.getEditor(),
      getStyling: () => documentStylingRef.current,
      setZoomLevel: (zoom: string) => setZoomLevel(zoom),
      getYdoc: () => editorRef.current?.getYdoc(),
    }),
    [],
  );
  // Pages M0: window.__ddocPages, and the ?pagesFixture= loader.
  useEffect(() => {
    const api = installPagesDebug(pagesDeps);
    const fixture = PAGES_FIXTURES.find(
      (f) =>
        f.id === new URLSearchParams(window.location.search).get('pagesFixture'),
    );
    if (!fixture) return;
    let cancelled = false;
    const load = async () => {
      let editor = pagesDeps.getEditor();
      while (!cancelled && (!editor || editor.isDestroyed)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        editor = pagesDeps.getEditor();
      }
      // A v2 doc is stamped once content resolves; content set before that
      // blocks the stamp and leaves the doc v1.
      const wantsV2 =
        new URLSearchParams(window.location.search).get('v1') !== '1';
      const deadline = Date.now() + 10000;
      while (
        wantsV2 &&
        !cancelled &&
        Date.now() < deadline &&
        editorRef.current?.getYdoc()?.getMap('ddocMeta').get('schemaVersion') ==
          null
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      editor = pagesDeps.getEditor();
      if (cancelled || !editor) return;
      editor.commands.setContent(fixture.html);
      await waitForLayout(editor.view.dom);
      if (!cancelled) api.ready = true;
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [pagesDeps]);

  // Poll tab state from Y.Doc for DevBar
  useEffect(() => {
    const interval = setInterval(() => {
      if (!editorRef.current) return;
      try {
        const ydoc = editorRef.current.getYdoc();
        if (!ydoc) return;
        const root = ydoc.getMap('ddocTabs');
        const order = root.get('order');
        const activeTab = root.get('activeTabId');
        if (order && activeTab) {
          setActiveTabInfo({
            activeTabId: activeTab.toString() || 'default',
            tabCount: order.length,
          });
        }
      } catch {
        // Editor not ready yet
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (paramCollaborationId && paramKey) {
      const name = prompt('Whats your username');
      if (!name) return;

      setCollabRoomKey(paramKey);
      setCollaborationId(paramCollaborationId);
      setUsername(name);
      setCollabIsOwner(false);
      setCollabEnabled(true);
    }
  }, [paramCollaborationId, paramKey]);
  //To handle comments from consumer side

  const [commentDrawerOpen, setCommentDrawerOpen] = useState(false);
  const [initialComments, setInitialComment] = useState<IComment[]>([]);

  const handleReplyOnComment = (id: string, reply: IComment) => {
    setInitialComment((prev) =>
      prev.map((comment) => {
        if (comment.id === id) {
          return {
            ...comment,
            replies: [
              ...(comment.replies || []),
              { ...reply, commentIndex: comment.replies?.length },
            ],
          };
        }
        return comment; // Ensure you return the unchanged comment
      }),
    );
  };
  const handleNewComment = (comment: IComment, meta?: CommentMutationMeta) => {
    setInitialComment((prev) => [
      ...prev,
      { ...comment, commentIndex: prev.length, version: '2' },
    ]);

    // Register the serialized anchor for every new comment that came in with
    // anchor positions (both regular comments and suggestions). The package's
    // initialCommentAnchors useEffect resets `commentAnchorsRef.current` to
    // whatever this prop holds whenever it changes — if a regular comment
    // isn't included here, a subsequent suggestion submit (which DOES
    // re-set this state) wipes the regular comment's anchor and its
    // decoration disappears.
    if (comment.id && meta?.anchorFrom && meta?.anchorTo) {
      const anchor: SerializedCommentAnchor = {
        id: comment.id,
        anchorFrom: meta.anchorFrom,
        anchorTo: meta.anchorTo,
        resolved: false,
        deleted: false,
        ...(comment.isSuggestion && {
          isSuggestion: true,
          suggestionType: meta.suggestionType,
          originalContent: meta.originalContent,
          suggestedContent: meta.suggestedContent,
        }),
      };
      setInitialCommentAnchors((prev) => [...prev, anchor]);
    }
  };
  const handleResolveComment = (commentId: string) => {
    setInitialComment(
      initialComments.map((comment) =>
        comment.id === commentId ? { ...comment, resolved: true } : comment,
      ),
    );
  };

  const handleUnresolveComment = (commentId: string) => {
    setInitialComment(
      initialComments.map((comment) =>
        comment.id === commentId ? { ...comment, resolved: false } : comment,
      ),
    );
  };
  const handleDeleteComment = (commentId: string) => {
    setInitialComment(
      initialComments.map((comment) => {
        if (comment.id === commentId) {
          return {
            ...comment,
            deleted: true,
          };
        } else {
          return { ...comment };
        }
      }),
    );
  };

  //To handle comments from consumer side

  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const stored = collabStore.getCollabConf();
    if (stored) {
      setCollabRoomKey(stored.roomKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCollaborationId(stored.roomId || (stored as any).collaborationId);
      setUsername(stored.username);
      setCollabIsOwner(stored.isOwner);
      setCollabExtras({
        ownerEdSecret: stored.ownerEdSecret,
        contractAddress: stored.contractAddress,
        ownerAddress: stored.ownerAddress,
        isEns: stored.isEns,
      });
      setCollabEnabled(true);
    }
  }, []);

  const onToggleCollaboration = async () => {
    const name = prompt('Whats your username');
    if (!name) return;
    const { privateKey } = cryptoUtils.generateKeyPair();

    const newCollabId = crypto.randomUUID();
    const privateKeyBase64 = fromUint8Array(privateKey, true);

    const extras = {
      ownerEdSecret: import.meta.env.VITE_OWNER_ED_SECRET,
      contractAddress: import.meta.env.VITE_COLLAB_CONTRACT_ADDRESS,
      ownerAddress: import.meta.env.VITE_COLLAB_OWNER_ADDRESS,
      isEns: true as const,
    };

    collabStore.setCollabConf({
      roomKey: privateKeyBase64,
      roomId: newCollabId,
      wsUrl: import.meta.env.VITE_COLLAB_WS_URL,
      isOwner: true,
      username: name,
      ...extras,
    });

    setCollabRoomKey(privateKeyBase64);
    setCollaborationId(newCollabId);
    setUsername(name);
    setCollabIsOwner(true);
    setCollabExtras(extras);
    setCollabEnabled(true);

    console.log(
      `${window.location.origin}?collaborationId=${newCollabId}#key=${privateKeyBase64}`,
    );

    await navigator.clipboard.writeText(
      `${window.location.origin}?collaborationId=${newCollabId}#key=${privateKeyBase64}`,
    );

    toast({
      title: 'Collaboration link copied to clipboard',
      variant: 'success',
      toastType: 'mini',
      iconType: 'icon',
    });
  };

  // --- Second-level nav wiring (capability engine, consumer-mirror) ---
  // isCommentUsable: demo has no publish/IPFS-availability concept (unlike
  // the consumer's comments.available/isDocumentPublished), so this derives
  // from the closest equivalents already tracked here: `isOnline` (network,
  // consumer's comments.available proxy) and `!collabEnabled` (RTC gate,
  // consumer's !enableCollaboration). No unpublished-doc gate to mirror.
  const caps = deriveCapabilities({
    isPreviewMode,
    isCollaboratorMode: collabEnabled && !collabIsOwner,
    isDDocOwner,
    isAuthenticated: isConnected,
    isOnline,
    hasSelection: false, // refined inside SecondLevelNav from the registry
    permissionAllowsComment: !disableInlineComment,
    isRtcEnabled: collabEnabled,
    isCommentUsable: isOnline && !collabEnabled,
  });

  const renderNavbar = ({
    editor,
    liveEditor,
  }: {
    editor: JSONContent;
    liveEditor: Editor | null;
  }): JSX.Element => {
    const publishDoc = () => console.log(editor, title);
    const appActions = createDemoAppActions({
      liveEditor,
      printCurrentTab: () => editorRef.current?.printCurrentTab(),
      exportModal: (format?: string) =>
        editorRef.current?.exportCurrentTabOrOpenExportModal(format),
      exportMarkdown: () =>
        editorRef.current?.exportContentAsMarkDown(title || 'Untitled'),
      onError: (msg) =>
        toast({
          title: 'Error',
          description: msg,
          variant: 'error',
          iconType: 'icon',
        }),
      isFocusMode,
      setIsFocusMode,
      showTOC,
      setShowTOC,
      openCommentsDrawer: () => setCommentDrawerOpen(true),
      canvasCommentsHidden: disableInlineComment,
      toggleCanvasComments: () => setDisableInlineComment((v) => !v),
      isSplitView,
      toggleSplitView: () => setIsSplitView((v: boolean) => !v),
      createTab: () => editorRef.current?.createTab?.(),
      toggleStyling: () => setShowStylingControls((v) => !v),
      zoomLevel,
      setZoomLevel,
      documentStyling,
      setDocumentStyling,
      setPageMode,
      startPresentation: () => setIsPresentationMode(true),
      openWordCountModal: () => setWordCountModalOpen(true),
      openVersionHistory,
    });

    return (
      <nav className="color-bg-default p-2 flex gap-10 items-center justify-between w-full shrink-0 border-b color-border-default z-[45]">
        {/* Split view's markdown pane is the sole input surface — the doc
            menus must not be reachable while it is active. */}
        {!isSplitView && (
          <SecondLevelNav
            tree={demoMenuTree}
            liveEditor={liveEditor}
            caps={caps}
            appActions={appActions}
          />
        )}
        <div className="flex gap-2 items-center">
          <DocSwitcher currentDocId={docId} currentTitle={title} />
          <div className="relative truncate inline-block xl:!max-w-[300px] !max-w-[108px] color-bg-default text-[14px] font-medium leading-[20px]">
            <span className="invisible whitespace-pre">
              {title || 'Untitled'}
            </span>
            <input
              className="focus:outline-none truncate color-bg-default absolute top-0 left-0 right-0 bottom-0 select-text"
              type="text"
              placeholder="Untitled"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />
          </div>
          <Tag
            icon="CircleCheck"
            variant="transparent"
            className="h-6 rounded border color-border-default color-text-secondary text-[12px] font-normal hidden xl:flex"
            style={{ backgroundColor: 'hsl(var(--color-bg-secondary))' }}
          >
            {lastSavedAt ? 'Saved' : 'Not saved yet'}
          </Tag>
          {/* Shown as soon as the node answers, read-only nodes included:
              nothing is saved there, but versions stay browsable. Visible on
              laptop widths too (from sm, not xl like the badges around it):
              it is the save state and the way into version history. */}
          {(swarmStatus.state !== 'off' ||
            nodeState.kind === 'ready' ||
            nodeState.kind === 'read-only') && (
            <div className="relative hidden sm:block">
              <button
                type="button"
                ref={swarmTagRef}
                onClick={openVersionHistory}
                className="h-6 rounded border color-border-default color-text-secondary text-[12px] font-normal flex items-center gap-1 px-2 cursor-pointer whitespace-nowrap"
                style={{ backgroundColor: 'hsl(var(--color-bg-secondary))' }}
                title={
                  (nodeState.kind === 'read-only'
                    ? `Edits are kept in this browser only: ${nodeState.reason.toLowerCase()}, so nothing is written to Swarm. Get a postage batch to save. `
                    : '') +
                  (!storeOnly
                    ? 'Document versions are saved to Swarm only without ?localCopy=1. '
                    : '') +
                  (stampHealth
                    ? `Postage stamp ${stampHealth.status}: ${Math.round(stampHealth.utilization * 100)}% full, expires ${stampHealth.expiresAt.toLocaleDateString()}. `
                    : '') +
                  'Click for version history'
                }
              >
                <SwarmIcon />
                {versionPreview
                  ? `Swarm: viewing v${versionPreview.index}`
                  : !canWrite || !storeOnly
                    ? 'Swarm: not saving'
                    : swarmStatus.state === 'saving'
                      ? 'Swarm: saving…'
                      : swarmStatus.state === 'saved'
                        ? `Swarm: saved v${swarmStatus.version}`
                        : swarmStatus.state === 'error'
                          ? 'Swarm: save failed'
                          : swarmStatus.state === 'none'
                            ? 'Swarm: no version yet'
                            : 'Swarm: connected'}
                {stampHealth && stampHealth.status !== 'ok'
                  ? ` · stamp ${stampHealth.status}`
                  : ''}
              </button>
              {versionsOpen &&
                createPortal(
                  <div
                    className="fixed min-w-56 max-h-72 overflow-y-auto rounded border color-border-default color-bg-default shadow-elevation-3 text-[12px]"
                    style={{
                      backgroundColor: 'hsl(var(--color-bg-default))',
                      top: versionMenuPos.top,
                      left: versionMenuPos.left,
                      zIndex: 99999,
                    }}
                  >
                    {versionPreview && (
                      <>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 hover:color-bg-secondary font-medium"
                          onClick={() => {
                            setVersionsOpen(false);
                            setRestoringVersion(versionPreview);
                          }}
                        >
                          ⤴ Restore v{versionPreview.index} as latest
                        </button>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 hover:color-bg-secondary"
                          onClick={() => {
                            setVersionsOpen(false);
                            exitVersionPreview();
                          }}
                        >
                          ← Back to latest
                        </button>
                        <div className="border-t color-border-default" />
                      </>
                    )}
                    {versionList === null && (
                      <div className="px-3 py-2 color-text-secondary">
                        Loading versions…
                      </div>
                    )}
                    {versionListError ? (
                      <div className="px-3 py-2 color-text-secondary max-w-80 whitespace-normal">
                        Could not list the versions from here:{' '}
                        {versionListError}
                      </div>
                    ) : (
                      versionList?.length === 0 && (
                        <div className="px-3 py-2 color-text-secondary">
                          No versions yet
                        </div>
                      )
                    )}
                    {versionList
                      ?.slice()
                      .reverse()
                      .map((v) => (
                        <button
                          key={v.index}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:color-bg-secondary flex justify-between gap-3"
                          onClick={() => previewVersion(v.index)}
                        >
                          <span>
                            v{v.index}
                            {v.index ===
                            versionList[versionList.length - 1]?.index
                              ? ' (latest)'
                              : ''}
                            {v.index === versionPreview?.index
                              ? ' (viewing)'
                              : ''}
                          </span>
                          <span className="color-text-secondary">
                            {new Date(v.timestamp * 1000).toLocaleString()}
                          </span>
                        </button>
                      ))}
                  </div>,
                  document.body,
                )}
            </div>
          )}
          <div className="w-6 h-6 rounded color-bg-secondary flex justify-center items-center border color-border-default xl:hidden">
            <LucideIcon
              name="BadgeCheck"
              size="sm"
              className="color-text-secondary"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />

          {isMediaMax1280px ? (
            <DynamicDropdown
              key="navbar-more-actions"
              align="center"
              sideOffset={10}
              anchorTrigger={
                <IconButton
                  icon={'EllipsisVertical'}
                  variant="ghost"
                  size="md"
                />
              }
              content={
                <div className="flex flex-col gap-1 p-2 w-fit shadow-elevation-3 ">
                  <Button
                    variant={'ghost'}
                    onClick={() => setShowTOC(true)}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name="List" size="sm" />
                    Document Outline
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={cycleMode}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name={modeIcon} size="sm" />
                    {modeLabel}
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={() => setDisableInlineComment((v) => !v)}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon
                      name={disableInlineComment ? 'EyeOff' : 'Eye'}
                      size="sm"
                    />
                    {disableInlineComment
                      ? 'Show inline comments'
                      : 'Hide inline comments'}
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={() => {}}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name="Share2" size="sm" />
                    Share
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={() => setShowStylingControls(!showStylingControls)}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name="Palette" size="sm" />
                    Styling
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <IconButton
                variant={'ghost'}
                icon={modeIcon}
                size="md"
                title={`${modeLabel} mode — click to switch to ${nextModeLabel}`}
                onClick={cycleMode}
              />
              <IconButton
                variant={'ghost'}
                icon="Share2"
                className="flex xl:hidden"
                size="md"
              />
              <IconButton
                variant={'ghost'}
                icon="Palette"
                size="md"
                onClick={() => setShowStylingControls(!showStylingControls)}
              />
            </>
          )}
          <IconButton
            variant={'ghost'}
            icon="MessageSquareText"
            size="md"
            onClick={() => setCommentDrawerOpen((prev) => !prev)}
          />
          {!collabEnabled ? (
            <IconButton
              variant={'ghost'}
              disabled={!isOwnerEdSecretSet}
              icon="Users"
              size="md"
              onClick={onToggleCollaboration}
            />
          ) : (
            <DynamicDropdown
              key="navbar-more-actions"
              align="center"
              sideOffset={10}
              anchorTrigger={
                <IconButton icon={'Users'} variant="ghost" size="md" />
              }
              content={
                <div className="flex flex-col gap-1 p-2 w-fit shadow-elevation-3 ">
                  {collabIsOwner ? (
                    <Button
                      variant={'ghost'}
                      onClick={() => {
                        editorRef.current?.terminateSession();
                        setCollabEnabled(false);
                        setCollaborationId('');
                        setCollabRoomKey('');
                        setUsername('');
                        setCollabIsOwner(false);
                        setCollabExtras({});
                        setCollabStatus('off');
                        collabStore.clearCollabConf();
                      }}
                    >
                      Stop Collaboration
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => {
                      const base_name = 'sussy_baka';
                      const random_number = Math.floor(Math.random() * 1000000);
                      const new_name = `${base_name}_${random_number}`;
                      editorRef.current?.updateCollaboratorName(new_name);
                    }}
                    variant={'ghost'}
                  >
                    Update Collaborator Name
                  </Button>
                </div>
              }
            />
          )}

          <Button
            onClick={publishDoc}
            toggleLeftIcon={true}
            leftIcon="Share2"
            variant={'ghost'}
            className="!min-w-[90px] !px-0 hidden xl:flex"
          >
            Share
          </Button>
          <div className="flex gap-2 px-2 justify-center items-center">
            <LucideIcon name="Farcaster" />
            <div className="flex-col hidden xl:flex">
              <p className="text-heading-xsm">@[username]</p>
              <p className="text-helper-text-sm">Farcaster</p>
            </div>
          </div>
        </div>
      </nav>
    );
  };

  const handleConnectViaUsername = async (username: string) => {
    setUsername(username);
    setIsConnected(true);
  };

  const onCollaboratorChange = (collaborators: unknown[] | undefined) => {
    console.log('onCollaboratorChange', collaborators);
  };

  const collaboration = useMemo((): CollaborationProps => {
    if (!collabEnabled || !collaborationId || !collabRoomKey) {
      return { enabled: false };
    }
    return {
      enabled: true,
      connection: {
        roomKey: collabRoomKey,
        roomId: collaborationId,
        wsUrl: import.meta.env.VITE_COLLAB_WS_URL,
        isOwner: collabIsOwner,
        ownerEdSecret: collabExtras.ownerEdSecret,
        contractAddress: collabExtras.contractAddress,
        ownerAddress: collabExtras.ownerAddress,
      },
      session: {
        username,
        isEns: collabExtras.isEns,
      },
      services: {},
      on: {
        onStateChange: (state: CollabState) => {
          console.log('onStateChange', state);
          if (state.status === 'syncing') {
            setCollabStatus(
              state.hasUnmergedPeerUpdates ? 'merging' : 'syncing',
            );
          } else {
            setCollabStatus(state.status);
          }
          if (state.status === 'syncing' && state.hasUnmergedPeerUpdates) {
            toast({
              title: 'Syncing all new changes',
              variant: 'info',
              toastType: 'mini',
              iconType: 'icon',
            });
          } else if (state.status === 'reconnecting') {
            toast({
              title: `Reconnecting (${state.attempt}/${state.maxAttempts})...`,
              variant: 'warning',
              toastType: 'mini',
              iconType: 'icon',
            });
          } else if (state.status === 'error') {
            toast({
              title: 'Collaboration error',
              description: state.error.message,
              variant: 'error',
              iconType: 'icon',
            });
          }
        },
        onError: (error) => {
          console.log('onError', error);
          toast({
            title: 'Collaboration error',
            description: error.message,
            variant: 'error',
            iconType: 'icon',
          });
        },
      },
    };
  }, [
    collabEnabled,
    collaborationId,
    collabRoomKey,
    collabIsOwner,
    collabExtras,
    username,
  ]);

  return (
    <div className="h-[100dvh] w-full flex flex-col">
      <DocumentStylingPanel
        isOpen={showStylingControls}
        onClose={() => setShowStylingControls(false)}
        documentStyling={documentStyling}
        onStylingChange={setDocumentStyling}
      >
        <PagesPanel
          {...pagesDeps}
          documentStyling={documentStyling ?? {}}
          onStylingChange={(updates) =>
            setDocumentStyling((prev) => ({ ...(prev ?? {}), ...updates }))
          }
        />
      </DocumentStylingPanel>
      <div
        ref={setNavbarHost}
        className={`ddoc-navbar-row ${
          isFocusMode || !isNavbarVisible ? 'ddoc-navbar-row--hidden' : ''
        }`}
      />
      {/* A bar pinned to the bottom of the viewport (see SwarmNotice): the
          doc stays usable while whatever is wrong with Swarm is spelled out. */}
      {swarmCondition && !swarmRestoreGate && (
        <SwarmNotice
          condition={swarmCondition}
          beeUrl={swarmBeeUrl ?? ''}
          batchId={swarmBatchId}
          onRetry={recheckSwarm}
          onGrantAccess={grantSwarmAccess}
          onBatchReady={(id) => {
            adoptBatch(id);
            recheckSwarm();
          }}
        />
      )}
      <div className="flex-1 min-h-0">
        {swarmRestoreGate ? (
          <SwarmRestoreProgress
            nodeState={nodeState}
            progress={swarmProgress}
            managesPostage={swarmManagesPostage}
            attempt={restoreAttempt + 1}
            maxAttempts={MAX_RESTORE_ATTEMPTS}
            error={restoreError}
            onSkip={() => {
              setRestoreError(null);
              setSwarmRestore('done');
            }}
            onRetry={() => {
              setRestoreError(null);
              setRestoreAttempt((n) => n + 1);
            }}
          />
        ) : restoringVersion ? (
          <div className="p-6 text-[14px] color-text-secondary">
            Restoring version {restoringVersion.index} from Swarm…
          </div>
        ) : (
          <DdocEditor
            ref={editorRef}
            /* Stable key while switching versions (versionId re-hydrates the
             mounted editor); leaving version mode bumps the epoch, which
             remounts a fresh live session. */
            key={
              versionPreview ? 'swarm-version-preview' : `live-${editorEpoch}`
            }
            versionHistoryState={
              versionPreview
                ? {
                    enabled: true,
                    versionId: `swarm-v${versionPreview.index}`,
                    content: versionPreview.content,
                  }
                : undefined
            }
            imageUploadFn={imageUploadFn}
            imageFetchFn={imageFetchFn}
            navbarContainer={navbarHost}
            fonts={demoFonts}
            collaboration={collaboration}
            username={username}
            setUsername={setUsername}
            isPreviewMode={isPreviewMode || Boolean(versionPreview)}
            disableInlineComment={disableInlineComment}
            onChange={storeOnly ? undefined : handleContentChange}
            onLocalChange={storeOnly ? handleLocalChange : undefined}
            initialContent={
              storeOnly
                ? storeCheck.status === 'existing'
                  ? storeCheck.content
                  : storeCheck.status === 'new'
                    ? undefined
                    : null
                : initialContent
            }
            isNewDocument={
              storeOnly && storeCheck.status !== 'pending'
                ? storeCheck.status === 'new'
                : undefined
            }
            onIndexedDbError={handleIndexedDbError}
            enableIndexeddbSync={true}
            ddocId={docId}
            // Only consulted at doc creation; existing docs follow their marker.
            preferredSchemaVersion={
              new URLSearchParams(window.location.search).get('v1') === '1'
                ? 1
                : 2
            }
            tabConfig={tabConfig}
            onError={(error) => {
              toast({
                title: 'Error',
                description: error,
                variant: 'error',
                iconType: 'icon',
              });
            }}
            renderNavbar={renderNavbar}
            ensResolutionUrl={import.meta.env.ENS_RESOLUTION_URL}
            selectedTags={selectedTags}
            setSelectedTags={setSelectedTags}
            isCommentSectionOpen={isCommentSectionOpen}
            setIsCommentSectionOpen={setIsCommentSectionOpen}
            setInlineCommentData={setInlineCommentData}
            inlineCommentData={inlineCommentData}
            commentDrawerOpen={commentDrawerOpen}
            onCommentDrawerOpenChange={setCommentDrawerOpen}
            isPresentationMode={isPresentationMode}
            onPresentationModeChange={setIsPresentationMode}
            isFocusMode={isFocusMode}
            onFocusModeChange={setIsFocusMode}
            isSplitView={isSplitView}
            onSplitViewChange={setIsSplitView}
            zoomLevel={zoomLevel}
            onZoomLevelChange={setZoomLevel}
            isNavbarVisible={isNavbarVisible}
            onNavbarVisibleChange={setIsNavbarVisible}
            onComment={(): void => {}}
            onInlineComment={(): void => {}}
            onMarkdownImport={(): void => {}}
            onMarkdownExport={(): void => {}}
            onPdfExport={(): void => {}}
            onHtmlExport={(): void => {}}
            onTxtExport={(): void => {}}
            onDocxImport={(): void => {}}
            initialComments={initialComments}
            onCommentReply={handleReplyOnComment}
            onNewComment={handleNewComment}
            setInitialComments={setInitialComment}
            onResolveComment={handleResolveComment}
            onUnresolveComment={handleUnresolveComment}
            onDeleteComment={handleDeleteComment}
            showTOC={showTOC}
            onShowTOCChange={setShowTOC}
            isConnected={isConnected}
            connectViaWallet={async () => {}}
            isLoading={false}
            connectViaUsername={handleConnectViaUsername}
            onCopyHeadingLink={(link: string) => {
              navigator.clipboard.writeText(link);
              // Mirror the consumer (protected-document-context.tsx): the
              // package only supplies the slug; feedback is the host's job.
              toast({
                title: 'Anchor link copied to clipboard',
                toastType: 'mini',
                iconType: 'icon',
                customIcon: 'Link',
              });
            }}
            onCollaboratorChange={onCollaboratorChange}
            documentStyling={documentStyling}
            isDDocOwner={isDDocOwner}
            viewerMode={isDDocOwner ? undefined : viewerMode}
            initialCommentAnchors={initialCommentAnchors}
            onStatsChange={(stats) => {
              setCharacterCount(stats.characters);
              setWordCount(stats.words);
              setPageCount(stats.pages ?? 0);
            }}
          />
        )}
      </div>
      <DemoFooter
        wordCount={wordCount}
        pageCount={pageCount}
        isPagesMode={documentStyling?.pageSetup?.mode === 'pages'}
        onTogglePageMode={() => setPageMode(null)}
      />
      <WordCountModal
        open={wordCountModalOpen}
        onOpenChange={setWordCountModalOpen}
        pageCount={pageCount}
        wordCount={wordCount}
        characterCount={characterCount}
      />
      <Toaster
        position={!isMobile ? 'bottom-right' : 'center-top'}
        duration={3000}
      />
      <DevBar
        pageCount={pageCount}
        docId={docId}
        activeTabId={activeTabInfo.activeTabId}
        tabCount={activeTabInfo.tabCount}
        characterCount={characterCount}
        wordCount={wordCount}
        collabStatus={collabStatus}
        lastSavedAt={lastSavedAt}
      />
    </div>
  );
}

export default App;
