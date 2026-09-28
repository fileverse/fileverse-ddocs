/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { removeAwarenessStates } from 'y-protocols/awareness.js';

import { SyncManager } from './SyncManager';
import {
  SyncManagerConfig,
  CollabConnectionConfig,
  CollabState,
} from './types';

const INITIAL_STATE: CollabState = { status: 'idle' };

export const useSyncManager = (config: SyncManagerConfig) => {
  const [collabState, setCollabState] = useState<CollabState>(INITIAL_STATE);

  const managerRef = useRef<SyncManager | null>(null);
  const hasReachedReadyRef = useRef(false);

  if (!managerRef.current) {
    managerRef.current = new SyncManager(config, setCollabState);
  }

  const manager = managerRef.current;

  // Keep refs fresh on every render to prevent stale closures
  manager.updateRefs(config.services, config.callbacks, config.onLocalUpdate);

  const isConnected = manager.isConnected;
  const awareness = manager.awareness;

  // Local ydoc update listener — use isConnected (covers ready, syncing,
  // reconnecting) so local edits are queued during reconnection instead of
  // being dropped.  enqueueLocalUpdate only processes the queue when status
  // is 'ready', so queued updates are held safely until then.
  useEffect(() => {
    if (!isConnected || !config.ydoc) return;

    const updateHandler = (update: Uint8Array, origin: any) => {
      if (origin === 'self' || origin === 'remote' || !manager.isConnected)
        return;
      // Skip origins from external providers (e.g. y-indexeddb).
      // Guard against ref.current being null — otherwise a default-origin
      // transact (origin === null) would collide with an uninitialised
      // provider ref in collab mode and get filtered out.
      if (
        config.ignoredOrigins?.some(
          (ref) => ref.current !== null && ref.current === origin,
        )
      )
        return;
      manager.enqueueLocalUpdate(update);
    };

    config.ydoc.on('update', updateHandler);
    return () => {
      config.ydoc.off('update', updateHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.ydoc, isConnected]);

  // Resume triggers for a session that dropped on a transient loss: the next local edit, the
  // tab coming back to the foreground, or the network returning. resume() is a no-op unless
  // the manager is idle and resumable, so these stay cheap. Bound only while collaboration is
  // on (callbacks are absent otherwise).
  const collabOn = !!config.callbacks;
  useEffect(() => {
    if (!collabOn || !config.ydoc) return;
    const resume = () => managerRef.current?.resume();

    const onLocalEdit = (_update: Uint8Array, origin: any) => {
      if (origin === 'self' || origin === 'remote') return;
      if (
        config.ignoredOrigins?.some(
          (ref) => ref.current !== null && ref.current === origin,
        )
      )
        return;
      resume();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') resume();
    };

    config.ydoc.on('update', onLocalEdit);
    const hasWindow =
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function';
    const hasDocument =
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function';
    if (hasWindow) window.addEventListener('online', resume);
    if (hasDocument) {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      config.ydoc.off('update', onLocalEdit);
      if (hasWindow) window.removeEventListener('online', resume);
      if (hasDocument) {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.ydoc, collabOn]);

  // Awareness cleanup — on unmount + beforeunload
  useEffect(() => {
    if (!awareness) return;

    const beforeUnloadHandler = () => {
      removeAwarenessStates(awareness, [config.ydoc.clientID], 'window unload');
    };

    if (
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      window.addEventListener('beforeunload', beforeUnloadHandler);
    }

    return () => {
      removeAwarenessStates(awareness, [config.ydoc.clientID], 'hook unmount');
      if (
        typeof window !== 'undefined' &&
        typeof window.removeEventListener === 'function'
      ) {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awareness !== undefined]);

  // Force cleanup on unmount (replaces useRtcWebsocketDisconnector)
  useEffect(() => {
    return () => {
      managerRef.current?.forceCleanup();
    };
  }, []);

  // Hard tab-close: beacon the last pending edits (local y-indexeddb covers same-device
  // reopen; this closes the cross-device tail). pagehide fires on mobile/bfcache where
  // beforeunload does not.
  useEffect(() => {
    const onPageHide = () => {
      managerRef.current?.fireBeacon();
    };
    if (
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      window.addEventListener('pagehide', onPageHide);
    }
    return () => {
      if (
        typeof window !== 'undefined' &&
        typeof window.removeEventListener === 'function'
      ) {
        window.removeEventListener('pagehide', onPageHide);
      }
    };
  }, []);

  const connect = useCallback(
    (connectConfig: CollabConnectionConfig) => {
      manager.connect(connectConfig).catch((err) => {
        console.error('useSyncManager: connect failed', err);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.ydoc],
  );

  const disconnect = useCallback(() => {
    manager.disconnect();
  }, [manager]);

  const terminateSession = useCallback(() => {
    manager.terminateSession();
  }, [manager]);

  const updateTitle = useCallback(
    (args: { encryptedTitle: string; documentTitle: string }) => {
      manager.updateTitle(args).catch((err) => {
        console.error('useSyncManager: updateTitle failed', err);
      });
    },
    [manager],
  );

  const isSyncing = collabState.status === 'syncing';
  const isReady = collabState.status === 'ready' && !!awareness;

  // A resume (idle -> connecting -> syncing after a transient drop) is the same document
  // coming back, not a fresh load: keep the content marked initialised through it so the
  // editor is not swapped for a loading state mid-keystroke.
  const isResuming = manager.isResuming;
  if (
    (collabState.status === 'idle' || collabState.status === 'connecting') &&
    !isResuming
  ) {
    hasReachedReadyRef.current = false;
  } else if (collabState.status === 'ready') {
    hasReachedReadyRef.current = true;
  }

  // Reconnecting can now happen during initial sync, before content has loaded.
  // Only treat reconnecting as initialized after this connection reached ready.
  const hasCollabContentInitialised =
    collabState.status === 'ready' ||
    ((collabState.status === 'reconnecting' || isResuming) &&
      hasReachedReadyRef.current);

  return {
    state: collabState,
    connect,
    disconnect,
    terminateSession,
    updateTitle,
    isReady,
    isSyncing,
    awareness,
    hasCollabContentInitialised,
  };
};
