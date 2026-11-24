import { useRef, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { EditorContent, type Editor } from '@tiptap/react';
import * as Y from 'yjs';
import type { createCommentStore } from '../../stores/comment-store';
import { CommentStoreProvider } from '../../stores/comment-store-provider';
import { EditorProvider } from '../../context/editor-context';
import { EditingProvider } from '../../hooks/use-editing-context';
import { ColumnsMenu } from '../../extensions/multi-column/menus/columns-menu';
import { PasteAsMenu } from '../../extensions/paste-as/paste-as-menu';
import { CommentBubbleCard } from '../inline-comment/comment-bubble-card';
import {
  destroyTracked,
  makeEditor,
  track,
} from '../../extensions/caret-marks/test-helpers';
import { EditorBubbleMenu } from './editor-bubble-menu';

// Every BubbleMenu render the hosts cause, with the props it received: a
// memoised host that bails out never gets here, so it cannot fake a re-render.
const bubbleRenders = vi.hoisted(() => ({
  all: [] as Record<string, unknown>[],
}));
vi.mock('@tiptap/react/menus', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@tiptap/react/menus')>();
  const { createElement, forwardRef } = await import('react');
  const Original = mod.BubbleMenu as React.ElementType;
  const Spy = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    bubbleRenders.all.push(props);
    return createElement(Original, { ...props, ref });
  });
  return { ...mod, BubbleMenu: Spy };
});

// BubbleMenu dispatches an `updateOptions` transaction whenever a prop's
// identity changes (Tiptap 3.20+), so each host must pass stable `options` and
// closures: a re-render of the host's parent dispatches nothing.

type Host = {
  name: string;
  // EditorBubbleMenu is React.memo: a parent re-render never reaches it, only
  // its own store subscriptions do.
  rendersWith: 'parent' | 'store';
  render: (editor: Editor, appendTo: React.RefObject<HTMLElement>) => ReactNode;
};

const hosts: Host[] = [
  {
    name: 'EditorBubbleMenu',
    rendersWith: 'store',
    render: (editor) => (
      <EditorBubbleMenu
        editor={editor}
        activeCommentId={null}
        isPreviewMode={false}
        disableInlineComment={false}
      />
    ),
  },
  {
    name: 'ColumnsMenu',
    rendersWith: 'parent',
    render: (editor, appendTo) => (
      <ColumnsMenu editor={editor} appendTo={appendTo} />
    ),
  },
  {
    name: 'CommentBubbleCard',
    rendersWith: 'parent',
    render: (editor) => (
      <CommentBubbleCard
        editor={editor}
        activeCommentId={null}
        commentDrawerOpen={false}
        isCollabDocumentPublished={true}
      />
    ),
  },
  {
    name: 'PasteAsMenu',
    rendersWith: 'parent',
    render: (editor) => <PasteAsMenu editor={editor} />,
  },
];

type StoreApi = ReturnType<typeof createCommentStore>;

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  cleanup();
  destroyTracked();
});

describe.each([1, 2])('menu dispatches, schema v%i', (version) => {
  describe.each(hosts)('$name', (host) => {
    it('dispatches 0 transactions per re-render', async () => {
      const ydoc = new Y.Doc();
      const editor = track(makeEditor(version, '<p>hello world</p>', { ydoc }));
      const storeApiRef: { current: StoreApi | null } = { current: null };
      const register = vi.spyOn(editor, 'registerPlugin');
      const unregister = vi.spyOn(editor, 'unregisterPlugin');

      // Props identity is fixed across renders; only the parent re-renders.
      const props = { editor, ydoc };
      const Tree = ({ round }: { round: number }) => {
        const appendTo = useRef<HTMLElement>(document.body);
        return (
          <EditorProvider>
            <EditingProvider isPreviewMode={false}>
              <CommentStoreProvider
                editor={props.editor}
                ydoc={props.ydoc}
                initialComments={[]}
                username={null}
                activeCommentId={null}
                activeTabId="default"
                ensResolutionUrl=""
                setActiveCommentId={noop}
                focusCommentWithActiveId={noop}
                storeApiRef={storeApiRef}
              >
                <div data-round={round}>
                  <EditorContent editor={props.editor} />
                  {host.render(props.editor, appendTo)}
                </div>
              </CommentStoreProvider>
            </EditingProvider>
          </EditorProvider>
        );
      };

      const { rerender } = render(<Tree round={0} />);
      await flush();
      expect(storeApiRef.current).not.toBeNull();
      expect(register).toHaveBeenCalled();
      register.mockClear();
      unregister.mockClear();
      bubbleRenders.all.length = 0;

      let transactions = 0;
      editor.on('transaction', () => (transactions += 1));

      for (let round = 1; round <= 3; round++) {
        rerender(<Tree round={round} />);
        await flush();
      }
      const parentRenders = bubbleRenders.all.splice(0);

      // A state change inside the host's own subtree re-renders it as well.
      for (let i = 0; i < 3; i++) {
        act(() =>
          storeApiRef
            .current!.getState()
            .setIsBubbleMenuSuppressed(i % 2 === 0),
        );
        await flush();
      }

      const storeRenders = bubbleRenders.all.splice(0);

      // Every re-render reaches BubbleMenu with the same `options` object.
      const proving =
        host.rendersWith === 'parent' ? parentRenders : storeRenders;
      expect(proving.length).toBeGreaterThanOrEqual(3);
      expect(new Set(proving.map((p) => p.options)).size).toBe(1);
      if (host.rendersWith === 'store') expect(parentRenders).toHaveLength(0);
      expect(transactions).toBe(0);
      // ColumnsMenu's plugin key gets a fresh uuid each render; BubbleMenu
      // resolves it once, so nothing re-registers.
      expect([
        register.mock.calls.length,
        unregister.mock.calls.length,
      ]).toEqual([0, 0]);
    });
  });
});

function noop() {}
