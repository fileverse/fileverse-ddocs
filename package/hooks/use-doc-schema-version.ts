import { useEffect, useMemo, useReducer, useRef } from 'react';
import * as Y from 'yjs';
import {
  DDOC_META_ROOT_KEY,
  SCHEMA_VERSION_META_KEY,
  SUPPORTED_SCHEMA_VERSION,
  docHasBlockContent,
  docHasV1Blocks,
} from '../utils/schema-version';
import type { SchemaStampGuardEvent } from '../types';

interface UseDocSchemaVersionArgs {
  ydoc: Y.Doc;
  // Mirrors useTabManager's isNewDdoc: owner, no collab, no initial content.
  isNewDdoc: boolean;
  // False while IndexedDB may still replay content for this doc; a doc is
  // only "genuinely new" once that possibility is exhausted.
  isContentResolved: boolean;
  preferredSchemaVersion?: number;
  onSchemaStampGuard?: (event: SchemaStampGuardEvent) => void;
}

// Resolves which schema a doc uses and stamps brand-new docs with the
// preferred version. Must be called AFTER useTabManager in the hook order:
// useTabManager decodes initialContent into the ydoc synchronously during
// render, and reading the marker here at render time (not in state) means
// the very first editor build already sees the right version.
//
// "Brand-new" is decided by the host's props (owner, no collab, no body).
// A host that hands an existing doc an empty body looks identical to a new
// doc, and a v2 stamp on a v1 body is destructive: the v2 extension set has
// no dBlock node, the editor renders nothing, and its next transaction
// writes that empty doc back into Yjs, deleting every tab. Two guards keep
// that from happening regardless of what the host passed:
//   - never stamp a doc whose body already holds blocks (IndexedDB replay or
//     an already-decoded body), and
//   - if v1 blocks land after this session stamped v2, revert the stamp in
//     the same render so the editor rebuilds as v1 before it can bind.
export const useDocSchemaVersion = ({
  ydoc,
  isNewDdoc,
  isContentResolved,
  preferredSchemaVersion = 1,
  onSchemaStampGuard,
}: UseDocSchemaVersionArgs) => {
  const [, bumpOnMetaChange] = useReducer((count: number) => count + 1, 0);
  const stampedHereRef = useRef(false);
  const onGuardRef = useRef(onSchemaStampGuard);
  onGuardRef.current = onSchemaStampGuard;

  useEffect(() => {
    const metaMap = ydoc.getMap(DDOC_META_ROOT_KEY);
    metaMap.observe(bumpOnMetaChange);
    return () => metaMap.unobserve(bumpOnMetaChange);
  }, [ydoc]);

  // Revert guard. Checked on every render while a stamp from this session
  // is live, and before the marker is read below, so the render in which
  // useTabManager decodes a late body already returns v1 and the editor
  // rebuilds before it can bind. Cheap: top-level blocks only, and only on
  // docs this session stamped. Only a stamp made here is ever reverted: a
  // marker that arrived with the content is the doc's own and stays.
  if (stampedHereRef.current && docHasV1Blocks(ydoc)) {
    ydoc.transact(() => {
      ydoc.getMap(DDOC_META_ROOT_KEY).delete(SCHEMA_VERSION_META_KEY);
    }, 'self');
    stampedHereRef.current = false;
    onGuardRef.current?.({ kind: 'reverted', preferredSchemaVersion });
  }

  const rawMarker = ydoc
    .getMap(DDOC_META_ROOT_KEY)
    .get(SCHEMA_VERSION_META_KEY);
  const markerVersion = typeof rawMarker === 'number' ? rawMarker : null;
  const stampRequested =
    markerVersion === null &&
    isContentResolved &&
    isNewDdoc &&
    preferredSchemaVersion >= 2;
  // Block guard: the host's "no body" is not trusted over the doc itself.
  const stampBlocked = stampRequested && docHasBlockContent(ydoc);
  const shouldStampNewDoc = stampRequested && !stampBlocked;

  useEffect(() => {
    if (!stampBlocked) return;
    onGuardRef.current?.({ kind: 'blocked', preferredSchemaVersion });
  }, [stampBlocked, preferredSchemaVersion]);

  // The package owns the marker: a doc is v2 iff its marker says so.
  // Render-phase write follows the deriveTabsFromEncodedState precedent
  // (tab seeding also writes to the ydoc from a useMemo). 'self' origin:
  // bootstrapping metadata is not a user edit, same as tab seeding.
  useMemo(() => {
    if (!shouldStampNewDoc) return;
    ydoc.transact(() => {
      ydoc
        .getMap(DDOC_META_ROOT_KEY)
        .set(SCHEMA_VERSION_META_KEY, preferredSchemaVersion);
    }, 'self');
    stampedHereRef.current = true;
  }, [shouldStampNewDoc, preferredSchemaVersion, ydoc]);

  const docSchemaVersion =
    markerVersion ?? (shouldStampNewDoc ? preferredSchemaVersion : 1);

  return {
    docSchemaVersion,
    isSchemaUnsupported: docSchemaVersion > SUPPORTED_SCHEMA_VERSION,
  };
};
