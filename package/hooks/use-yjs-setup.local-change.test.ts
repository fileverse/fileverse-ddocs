// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// Count full-document encodes: the point of onLocalChange is that a host
// which passes only it never pays for one.
const encodes = vi.hoisted(() => ({ count: 0 }));
vi.mock('yjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yjs')>();
  return {
    ...actual,
    encodeStateAsUpdate: (
      ...args: Parameters<typeof actual.encodeStateAsUpdate>
    ) => {
      encodes.count += 1;
      return actual.encodeStateAsUpdate(...args);
    },
  };
});

const { useYjsSetup } = await import('./use-yjs-setup');
const { SyncManager } = await import('../sync-local/SyncManager');

beforeEach(() => {
  vi.useFakeTimers();
  encodes.count = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// Edits carry an origin, as the editor's (y-prosemirror) do. An update with
// no origin equals the empty IndexedDB provider ref and is ignored by design.
const type = (doc: Y.Doc, text: string) =>
  act(() => {
    doc.transact(() => {
      doc.getText('body').insert(0, text);
    }, 'editor');
  });

describe('onLocalChange', () => {
  it('signals an edit after typing pauses, without encoding the document', () => {
    const onLocalChange = vi.fn();
    const { result } = renderHook(() => useYjsSetup({ onLocalChange }));

    type(result.current.ydoc, 'hello');
    type(result.current.ydoc, ' world');
    expect(onLocalChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onLocalChange).toHaveBeenCalledTimes(1);
    expect(onLocalChange).toHaveBeenCalledWith();
    expect(encodes.count).toBe(0);
  });

  it('signals a flushed change without encoding the document', () => {
    const onLocalChange = vi.fn();
    const { result } = renderHook(() => useYjsSetup({ onLocalChange }));

    act(() => {
      result.current.flushPendingUpdate();
    });
    expect(onLocalChange).toHaveBeenCalledTimes(1);
    expect(encodes.count).toBe(0);
  });

  it('still gives onChange the full document when a host asks for it', () => {
    const onChange = vi.fn();
    const onLocalChange = vi.fn();
    const { result } = renderHook(() =>
      useYjsSetup({ onChange, onLocalChange }),
    );

    type(result.current.ydoc, 'hello');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(typeof onChange.mock.calls[0][0]).toBe('string');
    expect(onChange.mock.calls[0][1]).not.toBe('');
    expect(onLocalChange).toHaveBeenCalledTimes(1);
    expect(encodes.count).toBe(1);
  });

  it('uses the latest callback after a re-render inside the debounce window', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onLocalChange }) => useYjsSetup({ onLocalChange }),
      { initialProps: { onLocalChange: first } },
    );

    type(result.current.ydoc, 'hello');
    rerender({ onLocalChange: second });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('SyncManager remote changes', () => {
  const remoteUpdate = () => {
    const other = new Y.Doc();
    other.getText('body').insert(0, 'from a collaborator');
    return Y.encodeStateAsUpdate(other);
  };

  it('signals onLocalChange without encoding the document', () => {
    const update = remoteUpdate();
    encodes.count = 0;
    const onLocalChange = vi.fn();
    const manager = new SyncManager(
      { ydoc: new Y.Doc(), onLocalChange },
      () => {},
    );

    (
      manager as unknown as {
        notifyHostOfRemoteChange: (update: Uint8Array) => void;
      }
    ).notifyHostOfRemoteChange(update);

    expect(onLocalChange).toHaveBeenCalledTimes(1);
    expect(encodes.count).toBe(0);
  });

  it('still encodes for onLocalUpdate, and a throwing host does not stop the other', () => {
    const update = remoteUpdate();
    encodes.count = 0;
    const onLocalUpdate = vi.fn(() => {
      throw new Error('host failed');
    });
    const onLocalChange = vi.fn();
    const manager = new SyncManager(
      { ydoc: new Y.Doc(), onLocalUpdate, onLocalChange },
      () => {},
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    (
      manager as unknown as {
        notifyHostOfRemoteChange: (update: Uint8Array) => void;
      }
    ).notifyHostOfRemoteChange(update);

    expect(onLocalUpdate).toHaveBeenCalledTimes(1);
    expect(encodes.count).toBe(1);
    expect(onLocalChange).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });
});
