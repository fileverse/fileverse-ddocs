import * as Y from 'yjs';

export const DDOC_META_ROOT_KEY = 'ddocMeta';
export const SCHEMA_VERSION_META_KEY = 'schemaVersion';

// The highest doc schema this build can safely open for editing.
// 1 = dBlock wrapper, 2 = flat (wrapper-less) blocks.
export const SUPPORTED_SCHEMA_VERSION = 2;

// Docs created before the marker existed have no ddocMeta entry: treat as v1.
export const getDocSchemaVersion = (doc: Y.Doc): number => {
  const version = doc.getMap(DDOC_META_ROOT_KEY).get(SCHEMA_VERSION_META_KEY);
  return typeof version === 'number' ? version : 1;
};

export const isDocSchemaSupported = (doc: Y.Doc): boolean =>
  getDocSchemaVersion(doc) <= SUPPORTED_SCHEMA_VERSION;
