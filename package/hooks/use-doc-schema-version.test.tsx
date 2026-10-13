// package/hooks/use-doc-schema-version.test.tsx
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useDocSchemaVersion } from './use-doc-schema-version';
import {
  DDOC_META_ROOT_KEY,
  SCHEMA_VERSION_META_KEY,
} from '../utils/schema-version';
import {
  DEFAULT_TAB_ID,
  ORDER_ROOT_KEY,
} from '../components/tabs/utils/tab-utils';

const readMarker = (ydoc: Y.Doc) =>
  ydoc.getMap(DDOC_META_ROOT_KEY).get(SCHEMA_VERSION_META_KEY);

// A v1 body: top-level dBlock wrappers, the shape every pre-marker doc has.
const insertV1Body = (ydoc: Y.Doc, tabId = DEFAULT_TAB_ID) => {
  ydoc.transact(() => {
    ydoc.getArray<string>(ORDER_ROOT_KEY).push([tabId]);
    const block = new Y.XmlElement('dBlock');
    block.insert(0, [new Y.XmlElement('paragraph')]);
    ydoc.getXmlFragment(tabId).insert(0, [block]);
  }, 'remote');
};

// A v2 body: flat blocks, no wrapper.
const insertV2Body = (ydoc: Y.Doc) => {
  ydoc.transact(() => {
    ydoc
      .getXmlFragment(DEFAULT_TAB_ID)
      .insert(0, [new Y.XmlElement('paragraph')]);
  }, 'remote');
};

// The host's view of an existing doc it mounted without a body: owner, no
// collab, empty initialContent. Identical to a brand-new doc from the
// package's side, which is exactly the hole the guards close.
const newDocArgs = (ydoc: Y.Doc, overrides = {}) => ({
  ydoc,
  isNewDdoc: true,
  isContentResolved: true,
  preferredSchemaVersion: 2,
  ...overrides,
});

describe('useDocSchemaVersion stamp guards', () => {
  it('stamps a genuinely empty new doc with the preferred version', () => {
    const ydoc = new Y.Doc();
    const { result } = renderHook(() => useDocSchemaVersion(newDocArgs(ydoc)));
    expect(readMarker(ydoc)).toBe(2);
    expect(result.current.docSchemaVersion).toBe(2);
  });

  it('refuses to stamp a doc whose body already holds blocks', () => {
    const ydoc = new Y.Doc();
    insertV1Body(ydoc);
    const onSchemaStampGuard = vi.fn();
    const { result } = renderHook(() =>
      useDocSchemaVersion(newDocArgs(ydoc, { onSchemaStampGuard })),
    );
    expect(readMarker(ydoc)).toBeUndefined();
    expect(result.current.docSchemaVersion).toBe(1);
    expect(onSchemaStampGuard).toHaveBeenCalledWith({
      kind: 'blocked',
      preferredSchemaVersion: 2,
    });
  });

  it('reverts its own stamp when v1 blocks arrive after it, in the same render', () => {
    const ydoc = new Y.Doc();
    const onSchemaStampGuard = vi.fn();
    const { result, rerender } = renderHook(
      (args: ReturnType<typeof newDocArgs>) => useDocSchemaVersion(args),
      { initialProps: newDocArgs(ydoc, { onSchemaStampGuard }) },
    );
    expect(readMarker(ydoc)).toBe(2);

    // The host fetched the body late: useTabManager decodes it into the ydoc
    // during render, then this hook runs in that same render.
    insertV1Body(ydoc);
    // isNewDdoc deliberately left true: the block guard must stop a
    // re-stamp on its own, with no help from the host's props.
    rerender(newDocArgs(ydoc, { onSchemaStampGuard }));

    expect(readMarker(ydoc)).toBeUndefined();
    expect(result.current.docSchemaVersion).toBe(1);
    expect(onSchemaStampGuard).toHaveBeenCalledWith({
      kind: 'reverted',
      preferredSchemaVersion: 2,
    });
  });

  it('keeps its stamp when flat v2 blocks arrive after it', () => {
    const ydoc = new Y.Doc();
    const { result, rerender } = renderHook(
      (args: ReturnType<typeof newDocArgs>) => useDocSchemaVersion(args),
      { initialProps: newDocArgs(ydoc) },
    );
    insertV2Body(ydoc);
    rerender(newDocArgs(ydoc));
    expect(readMarker(ydoc)).toBe(2);
    expect(result.current.docSchemaVersion).toBe(2);
  });

  it('never reverts a marker that arrived with the content', () => {
    const ydoc = new Y.Doc();
    ydoc.getMap(DDOC_META_ROOT_KEY).set(SCHEMA_VERSION_META_KEY, 2);
    insertV1Body(ydoc);
    const { result, rerender } = renderHook(
      (args: ReturnType<typeof newDocArgs>) => useDocSchemaVersion(args),
      { initialProps: newDocArgs(ydoc) },
    );
    rerender(newDocArgs(ydoc));
    expect(readMarker(ydoc)).toBe(2);
    expect(result.current.docSchemaVersion).toBe(2);
  });

  it('treats a doc with only seeded tab metadata as empty', () => {
    const ydoc = new Y.Doc();
    ydoc.getArray<string>(ORDER_ROOT_KEY).push([DEFAULT_TAB_ID]);
    ydoc.getXmlFragment(DEFAULT_TAB_ID);
    const { result } = renderHook(() => useDocSchemaVersion(newDocArgs(ydoc)));
    expect(readMarker(ydoc)).toBe(2);
    expect(result.current.docSchemaVersion).toBe(2);
  });
});
