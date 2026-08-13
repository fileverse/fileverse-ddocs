import { useEffect, useMemo, useReducer } from 'react';
import * as Y from 'yjs';
import {
  DDOC_META_ROOT_KEY,
  SCHEMA_VERSION_META_KEY,
  SUPPORTED_SCHEMA_VERSION,
} from '../utils/schema-version';

interface UseDocSchemaVersionArgs {
  ydoc: Y.Doc;
  // Mirrors useTabManager's isNewDdoc: owner, no collab, no initial content.
  isNewDdoc: boolean;
  // False while IndexedDB may still replay content for this doc; a doc is
  // only "genuinely new" once that possibility is exhausted.
  isContentResolved: boolean;
  preferredSchemaVersion?: number;
}

// Resolves which schema a doc uses and stamps brand-new docs with the
// preferred version. Must be called AFTER useTabManager in the hook order:
// useTabManager decodes initialContent into the ydoc synchronously during
// render, and reading the marker here at render time (not in state) means
// the very first editor build already sees the right version.
export const useDocSchemaVersion = ({
  ydoc,
  isNewDdoc,
  isContentResolved,
  preferredSchemaVersion = 1,
}: UseDocSchemaVersionArgs) => {
  const [, bumpOnMetaChange] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const metaMap = ydoc.getMap(DDOC_META_ROOT_KEY);
    metaMap.observe(bumpOnMetaChange);
    return () => metaMap.unobserve(bumpOnMetaChange);
  }, [ydoc]);

  const rawMarker = ydoc.getMap(DDOC_META_ROOT_KEY).get(SCHEMA_VERSION_META_KEY);
  const markerVersion = typeof rawMarker === 'number' ? rawMarker : null;
  const shouldStampNewDoc =
    markerVersion === null &&
    isContentResolved &&
    isNewDdoc &&
    preferredSchemaVersion >= 2;

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
  }, [shouldStampNewDoc, preferredSchemaVersion, ydoc]);

  const docSchemaVersion =
    markerVersion ?? (shouldStampNewDoc ? preferredSchemaVersion : 1);

  return {
    docSchemaVersion,
    isSchemaUnsupported: docSchemaVersion > SUPPORTED_SCHEMA_VERSION,
  };
};
