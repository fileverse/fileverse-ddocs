import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  DDOC_META_ROOT_KEY,
  SCHEMA_VERSION_META_KEY,
  SUPPORTED_SCHEMA_VERSION,
  getDocSchemaVersion,
  isDocSchemaSupported,
} from './schema-version';

const NEWER_THAN_SUPPORTED = SUPPORTED_SCHEMA_VERSION + 1;

describe('schema-version', () => {
  it('treats docs without a marker as v1 (every pre-marker doc)', () => {
    const doc = new Y.Doc();
    expect(getDocSchemaVersion(doc)).toBe(1);
    expect(isDocSchemaSupported(doc)).toBe(true);
  });

  it('accepts docs at the supported version', () => {
    const doc = new Y.Doc();
    doc
      .getMap(DDOC_META_ROOT_KEY)
      .set(SCHEMA_VERSION_META_KEY, SUPPORTED_SCHEMA_VERSION);
    expect(isDocSchemaSupported(doc)).toBe(true);
  });

  it('rejects docs from a newer schema', () => {
    const doc = new Y.Doc();
    doc
      .getMap(DDOC_META_ROOT_KEY)
      .set(SCHEMA_VERSION_META_KEY, NEWER_THAN_SUPPORTED);
    expect(getDocSchemaVersion(doc)).toBe(NEWER_THAN_SUPPORTED);
    expect(isDocSchemaSupported(doc)).toBe(false);
  });

  it('treats a malformed marker as v1 instead of locking the doc', () => {
    const doc = new Y.Doc();
    doc.getMap(DDOC_META_ROOT_KEY).set(SCHEMA_VERSION_META_KEY, 'two');
    expect(getDocSchemaVersion(doc)).toBe(1);
    expect(isDocSchemaSupported(doc)).toBe(true);
  });

  it('sees a marker applied via a remote update', () => {
    const source = new Y.Doc();
    source
      .getMap(DDOC_META_ROOT_KEY)
      .set(SCHEMA_VERSION_META_KEY, NEWER_THAN_SUPPORTED);

    const receiver = new Y.Doc();
    expect(isDocSchemaSupported(receiver)).toBe(true);
    Y.applyUpdate(receiver, Y.encodeStateAsUpdate(source));
    expect(isDocSchemaSupported(receiver)).toBe(false);
  });
});
