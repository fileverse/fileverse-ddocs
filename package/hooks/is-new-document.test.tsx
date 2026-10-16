// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDdocEditor } from '../use-ddoc-editor';
import {
  DDOC_META_ROOT_KEY,
  SCHEMA_VERSION_META_KEY,
} from '../utils/schema-version';

// TEC-2476 Step 5: a host that loads an existing doc from y-indexeddb passes
// no initialContent. Without isNewDocument the editor would take it for a new
// doc and stamp it with the preferred schema version, relabelling an existing
// version-1 doc as version 2.

const render = (isNewDocument?: boolean) =>
  renderHook(() =>
    useDdocEditor({
      isDDocOwner: true,
      initialContent: undefined,
      preferredSchemaVersion: 2,
      enableIndexeddbSync: false,
      ...(isNewDocument === undefined ? {} : { isNewDocument }),
    }),
  );

const marker = (result: ReturnType<typeof render>['result']) =>
  result.current.ydoc.getMap(DDOC_META_ROOT_KEY).get(SCHEMA_VERSION_META_KEY);

describe('isNewDocument', () => {
  it('stamps a doc with no initialContent as new when the host says nothing (unchanged)', () => {
    const { result } = render();
    expect(result.current.docSchemaVersion).toBe(2);
    expect(marker(result)).toBe(2);
  });

  it('does not stamp an existing doc the host loads without initialContent', () => {
    const { result } = render(false);
    expect(result.current.docSchemaVersion).toBe(1);
    expect(marker(result)).toBeUndefined();
  });

  it('still stamps when the host says the doc is new', () => {
    const { result } = render(true);
    expect(result.current.docSchemaVersion).toBe(2);
    expect(marker(result)).toBe(2);
  });

  it('passes a tab repair on an existing doc to the host, and keeps a new doc bootstrap quiet', () => {
    // No tab structure yet: the tab manager creates the default tab. For an
    // existing doc that is a real change to save; for a new doc it is not.
    const existing = vi.fn();
    renderHook(() =>
      useDdocEditor({
        isDDocOwner: true,
        enableIndexeddbSync: false,
        isNewDocument: false,
        onLocalChange: existing,
      }),
    );
    expect(existing).toHaveBeenCalled();

    const fresh = vi.fn();
    renderHook(() =>
      useDdocEditor({
        isDDocOwner: true,
        enableIndexeddbSync: false,
        isNewDocument: true,
        onLocalChange: fresh,
      }),
    );
    expect(fresh).not.toHaveBeenCalled();
  });
});
