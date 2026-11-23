import { Profiler, useRef, type ReactNode } from 'react';
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

// Probe for TIPTAP_UPGRADE.md §5.13. 3.34's BubbleMenu dispatches an
// `updateOptions` transaction whenever a prop's identity changes, and all four
// hosts pass inline `options`. Each case re-renders the host and counts the
// editor's transactions: it is 0 today and must stay 0 after the bump
// (memoise `options` and the closures where it is not).

type Host = {
  name: string;
  render: (editor: Editor, appendTo: React.RefObject<HTMLElement>) => ReactNode;
};

const hosts: Host[] = [
  {
    name: 'EditorBubbleMenu',
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
    render: (editor, appendTo) => (
      <ColumnsMenu editor={editor} appendTo={appendTo} />
    ),
  },
  {
    name: 'CommentBubbleCard',
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
      const commits = { host: 0 };
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
                  <Profiler id="host" onRender={() => (commits.host += 1)}>
                    {host.render(props.editor, appendTo)}
                  </Profiler>
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
      commits.host = 0;

      let transactions = 0;
      editor.on('transaction', () => (transactions += 1));

      for (let round = 1; round <= 3; round++) {
        rerender(<Tree round={round} />);
        await flush();
      }
      const parentCommits = commits.host;

      // A state change inside the host's own subtree re-renders it as well.
      for (let i = 0; i < 3; i++) {
        act(() =>
          storeApiRef
            .current!.getState()
            .setIsBubbleMenuSuppressed(i % 2 === 0),
        );
        await flush();
      }

      expect(commits.host).toBeGreaterThan(0);
      expect(parentCommits).toBeGreaterThan(0);
      expect(transactions).toBe(0);
      // Not a transaction, but the same churn: ColumnsMenu's plugin key holds
      // a fresh uuid on every render and 3.11 keeps the one it mounted with.
      expect([
        register.mock.calls.length,
        unregister.mock.calls.length,
      ]).toEqual([0, 0]);
    });
  });
});

function noop() {}
