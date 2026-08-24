import { useCallback, useMemo } from 'react';
import { Editor, useEditorState } from '@tiptap/react';
import {
  insertCommands,
  uploadImageCommand,
  UploadImageOptions,
} from '../utils/insert-commands';
import {
  FONT_SIZES,
  getCurrentLineHeight,
  readEffectiveSpacing,
  spacingToggleAction,
  uiValueToPercentage,
} from '../utils/typography';
import { applySpacingToggle } from '../components/editor-toolbar/spacing-toggles';
import { setShowReplacePopoverWithData } from '../extensions/search-replace/utils';
import {
  hasTextTargetAtSelection,
  selectWordAtCursor,
} from '../utils/selection-utils';
import {
  CommentStoreState,
  useCommentStoreOptional,
} from '../stores/comment-store';
import { openCustomSpacingDialog } from '../stores/custom-spacing-store';

// Module-scope stable selectors: useCommentStoreOptional's
// useSyncExternalStore contract compares snapshots with Object.is, so these
// must be plain field reads (not fresh closures) to avoid re-render loops.
const selectHandleInlineComment = (s: CommentStoreState) =>
  s.handleInlineComment;
const selectInlineCommentAvailable = (s: CommentStoreState) =>
  s.isInlineCommentAvailable;

export type EditorCommand = {
  run: (arg?: string) => void;
  isActive?: boolean;
  isEnabled: boolean;
  current?: string | null;
};

export type EditorCommandId =
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.selectAll'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.pasteWithoutFormatting'
  | 'edit.delete'
  | 'edit.findReplace'
  | 'insert.image'
  | 'insert.table'
  | 'insert.link'
  | 'insert.comment'
  | 'insert.callout'
  | 'insert.quote'
  | 'insert.code'
  | 'insert.codeBlock'
  | 'insert.video'
  | 'insert.mermaid'
  | 'insert.plainText'
  | 'insert.tweet'
  | 'insert.soundcloud'
  | 'insert.divider'
  | 'insert.pageBreak'
  | 'insert.columns2'
  | 'insert.columns3'
  | 'format.bold'
  | 'format.italic'
  | 'format.underline'
  | 'format.strike'
  | 'format.superscript'
  | 'format.subscript'
  | 'format.heading'
  | 'format.align'
  | 'format.direction'
  | 'format.lineHeight'
  | 'format.customSpacing'
  | 'format.spaceBefore'
  | 'format.spaceAfter'
  | 'format.fontFamily'
  | 'format.fontSize.increase'
  | 'format.fontSize.decrease'
  | 'format.list.bullet'
  | 'format.list.numbered'
  | 'format.list.check'
  | 'format.clearFormatting'
  | 'table.addRowAbove'
  | 'table.addRowBelow'
  | 'table.mergeCells'
  | 'table.deleteRow'
  | 'table.addColumnLeft'
  | 'table.addColumnRight'
  | 'table.deleteColumn'
  | 'table.toggleHeaderRow'
  | 'table.toggleHeaderColumn'
  | 'table.toggleHeaderCell'
  | 'table.deleteTable';

export type UseEditorCommandsOptions = UploadImageOptions;

const HEADING_LEVELS = [1, 2, 3] as const;

/** Effective font size at the selection — mirrors use-editor-states.tsx. */
const readFontSize = (editor: Editor): string => {
  let size = editor.getAttributes('textStyle')?.fontSize;
  if (!size && editor.isActive('paragraph')) {
    size = editor.getAttributes('paragraph')?.fontSize;
  }
  if (size) return size;
  if (editor.isActive('heading')) {
    const level = editor.getAttributes('heading').level;
    if (level === 1) return '32px';
    if (level === 2) return '24px';
    if (level === 3) return '18px';
  }
  return '16px';
};

/** Line-height attribute at the selection — mirrors use-editor-states.tsx. */
const readLineHeight = (editor: Editor): string => {
  let lineHeight = editor.getAttributes('paragraph')?.lineHeight;
  if (!lineHeight && editor.isActive('heading')) {
    lineHeight = editor.getAttributes('heading')?.lineHeight;
  }
  if (!lineHeight && editor.isActive('listItem')) {
    lineHeight = editor.getAttributes('listItem')?.lineHeight;
  }
  return lineHeight || '138%';
};

const currentHeading = (editor: Editor): string | null => {
  for (const level of HEADING_LEVELS)
    if (editor.isActive('heading', { level })) return String(level);
  return editor.isActive('paragraph') ? 'paragraph' : null;
};

const currentAlign = (editor: Editor): string | null => {
  for (const a of ['left', 'center', 'right', 'justify'])
    if (editor.isActive({ textAlign: a })) return a;
  return null;
};

const stepFontSize = (editor: Editor, direction: 1 | -1) => {
  const current = parseInt(readFontSize(editor), 10);
  const next =
    direction > 0
      ? FONT_SIZES.find((s) => s > current)
      : [...FONT_SIZES].reverse().find((s) => s < current);
  if (next) editor.chain().focus().setFontSize(`${next}px`).run();
};

/**
 * Reactive, editor-derived command registry (architecture doc §2 bucket 1).
 * INVARIANT: all isActive/current/isEnabled values are derived from the
 * editor via `useEditorState` (Tiptap's useSyncExternalStore wrapper) — the
 * hook holds no authoritative state of its own, so any number of instances
 * stay in sync, and consumers only re-render when a derived value changes
 * (deep-equality gated), not on every transaction.
 */
export const useEditorCommands = (
  editor: Editor | null,
  options: UseEditorCommandsOptions = {},
): Record<EditorCommandId, EditorCommand> => {
  const { onError, ipfsImageUploadFn } = options;

  // Optional (undefined outside a CommentStoreProvider) — see
  // useCommentStoreOptional's doc comment for the selector-stability
  // contract these module-scope selectors satisfy.
  const handleInlineComment = useCommentStoreOptional(
    selectHandleInlineComment,
  );
  const inlineCommentAvailable =
    useCommentStoreOptional(selectInlineCommentAvailable) ?? false;

  // Flat, comparable snapshot — no functions, so deepEqual can gate renders.
  //
  // useCallback is load-bearing, not tidiness: useEditorState memoises on the
  // selector identity, so an inline arrow is a fresh selector every render and
  // the whole snapshot is recomputed per render rather than per transaction.
  // readEffectiveSpacing below reads getComputedStyle — a forced style recalc —
  // and this hook renders with the consumer's menu bar, which has no memo
  // boundary. Same reasoning as the module-scope selectors above.
  const selector = useCallback(
    ({ editor: e }: { editor: Editor | null }) => {
      if (!e || e.isDestroyed) return null;
      // Which half of the add/remove toggle each edge should offer. Read here
      // rather than at dispatch time so the menu LABEL flips as soon as the
      // spacing changes — writing a margin moves nothing else in this snapshot.
      const spacing = readEffectiveSpacing(e);
      return {
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        hasSelection: !e.state.selection.empty,
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        superscript: e.isActive('superscript'),
        subscript: e.isActive('subscript'),
        code: e.isActive('code'),
        codeBlock: e.isActive('codeBlock'),
        quote: e.isActive('blockquote'),
        link: e.isActive('link'),
        direction: e.isActive('paragraph', { dir: 'rtl' })
          ? 'rtl'
          : e.isActive('paragraph', { dir: 'ltr' })
            ? 'ltr'
            : null,
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        taskList: e.isActive('taskList'),
        inTable: e.isActive('table'),
        canMergeCells: e.can().mergeCells(),
        heading: currentHeading(e),
        align: currentAlign(e),
        lineHeight: getCurrentLineHeight(e, readLineHeight(e)),
        spaceBefore: spacingToggleAction(spacing.spaceBefore),
        spaceAfter: spacingToggleAction(spacing.spaceAfter),
        fontFamily: (e.getAttributes('textStyle').fontFamily as string) ?? null,
        canInsertComment:
          inlineCommentAvailable &&
          Boolean(handleInlineComment) &&
          hasTextTargetAtSelection(e),
      };
    },
    [handleInlineComment, inlineCommentAvailable],
  );

  const state = useEditorState({ editor, selector });

  return useMemo(() => {
    const disabled: EditorCommand = { run: () => {}, isEnabled: false };
    if (!editor || editor.isDestroyed || !state) {
      return new Proxy({} as Record<EditorCommandId, EditorCommand>, {
        get: () => disabled,
      });
    }

    const cmd = (
      run: (arg?: string) => void,
      extra: Partial<EditorCommand> = {},
    ): EditorCommand => ({ run, isEnabled: true, ...extra });

    return {
      // --- edit ---
      'edit.undo': cmd(() => editor.chain().focus().undo().run(), {
        isEnabled: state.canUndo,
      }),
      'edit.redo': cmd(() => editor.chain().focus().redo().run(), {
        isEnabled: state.canRedo,
      }),
      'edit.selectAll': cmd(() => editor.chain().focus().selectAll().run()),
      'edit.delete': cmd(() => editor.chain().focus().deleteSelection().run(), {
        isEnabled: state.hasSelection,
      }),
      'edit.findReplace': cmd(() => setShowReplacePopoverWithData(editor)),
      'edit.cut': cmd(() => document.execCommand('cut'), {
        isEnabled: state.hasSelection,
      }),
      'edit.copy': cmd(() => document.execCommand('copy'), {
        isEnabled: state.hasSelection,
      }),
      'edit.paste': cmd(async () => {
        const text = await navigator.clipboard.readText();
        editor.chain().focus().insertContent(text).run();
      }),
      'edit.pasteWithoutFormatting': cmd(async () => {
        const text = await navigator.clipboard.readText();
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.selection, { type: 'text', text })
          .run();
      }),

      // --- insert (delegating to the shared module / thin wrappers) ---
      'insert.table': cmd(() => insertCommands.table(editor)),
      'insert.quote': cmd(() => insertCommands.quote(editor), {
        isActive: state.quote,
      }),
      'insert.code': cmd(() => insertCommands.code(editor), {
        isActive: state.code,
      }),
      'insert.codeBlock': cmd(() => insertCommands.codeBlock(editor), {
        isActive: state.codeBlock,
      }),
      'insert.callout': cmd(() => insertCommands.callout(editor)),
      'insert.divider': cmd(() => insertCommands.divider(editor)),
      'insert.pageBreak': cmd(() => insertCommands.pageBreak(editor)),
      'insert.columns2': cmd(() => insertCommands.columns2(editor)),
      'insert.columns3': cmd(() => insertCommands.columns3(editor)),
      'insert.image': cmd(() =>
        uploadImageCommand(editor, { onError, ipfsImageUploadFn }),
      ),
      'insert.video': cmd(() => insertCommands.video(editor)),
      'insert.mermaid': cmd(() => insertCommands.mermaid(editor)),
      'insert.plainText': cmd(() => insertCommands.plainText(editor)),
      'insert.tweet': cmd(() => insertCommands.tweet(editor)),
      'insert.soundcloud': cmd(() => insertCommands.soundcloud(editor)),
      'insert.link': cmd(
        (url) => {
          // same chain the link popup dispatches (editor-utils.tsx:1546)
          if (!url) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            return;
          }
          const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
          editor
            .chain()
            .focus()
            .extendMarkRange('link')
            .setLink({ href: finalUrl })
            .run();
        },
        { isActive: state.link },
      ),
      'insert.comment': cmd(
        () => {
          if (!selectWordAtCursor(editor)) return;
          handleInlineComment?.();
        },
        { isEnabled: state.canInsertComment },
      ),

      // --- format: marks ---
      'format.bold': cmd(() => editor.chain().focus().toggleBold().run(), {
        isActive: state.bold,
      }),
      'format.italic': cmd(() => editor.chain().focus().toggleItalic().run(), {
        isActive: state.italic,
      }),
      'format.underline': cmd(
        () => editor.chain().focus().toggleUnderline().run(),
        { isActive: state.underline },
      ),
      'format.strike': cmd(() => editor.chain().focus().toggleStrike().run(), {
        isActive: state.strike,
      }),
      'format.superscript': cmd(
        // exact chain used by the toolbar (editor-utils.tsx)
        () => editor.chain().focus().unsetSubscript().toggleSuperscript().run(),
        { isActive: state.superscript },
      ),
      'format.subscript': cmd(
        () => editor.chain().focus().unsetSuperscript().toggleSubscript().run(),
        { isActive: state.subscript },
      ),

      // --- format: block ---
      'format.heading': cmd(
        (arg) => {
          if (arg === 'paragraph') editor.chain().focus().setParagraph().run();
          else
            editor
              .chain()
              .focus()
              .toggleHeading({ level: Number(arg) as 1 | 2 | 3 })
              .run();
        },
        { current: state.heading },
      ),
      'format.align': cmd(
        (arg) => editor.chain().focus().setTextAlign(arg!).run(),
        { current: state.align },
      ),
      'format.direction': cmd(
        // same dispatch as the toolbar's LTR/RTL buttons
        (arg) => editor.commands.setTextDirection(arg as 'ltr' | 'rtl'),
        { current: state.direction },
      ),
      'format.lineHeight': cmd(
        (arg) => {
          if (!arg) return;
          // UI values ('1', '1.15', …) are stored as percentages; dispatch is
          // selection-aware like use-editor-states.tsx onSetLineHeight.
          const value = arg.includes('%') ? arg : uiValueToPercentage(arg);
          const { from, to } = editor.state.selection;
          if (from !== to) {
            editor.chain().focus().setLineHeight(value).run();
          } else {
            editor.chain().setLineHeight(value).run();
          }
        },
        { current: state.lineHeight },
      ),
      // Opens the shared dialog (mounted once by ddoc-editor) rather than
      // dispatching — the toolbar dropdown and bubble menu items do the same.
      'format.customSpacing': cmd(() => openCustomSpacingDialog()),
      // `current` is 'add' | 'remove' — the consumer's menu renders the label
      // from it, so the wording lives with the surface rather than here.
      'format.spaceBefore': cmd(
        () => applySpacingToggle(editor, 'before', state.spaceBefore),
        { current: state.spaceBefore },
      ),
      'format.spaceAfter': cmd(
        () => applySpacingToggle(editor, 'after', state.spaceAfter),
        { current: state.spaceAfter },
      ),
      'format.fontFamily': cmd(
        (arg) => editor.chain().focus().setFontFamily(arg!).run(),
        { current: state.fontFamily },
      ),
      'format.fontSize.increase': cmd(() => stepFontSize(editor, 1)),
      'format.fontSize.decrease': cmd(() => stepFontSize(editor, -1)),

      // --- format: lists ---
      'format.list.bullet': cmd(() => insertCommands.bulletList(editor), {
        isActive: state.bulletList,
      }),
      'format.list.numbered': cmd(() => insertCommands.numberedList(editor), {
        isActive: state.orderedList,
      }),
      'format.list.check': cmd(() => insertCommands.todoList(editor), {
        isActive: state.taskList,
      }),

      'format.clearFormatting': cmd(() =>
        editor.chain().focus().unsetAllMarks().clearNodes().run(),
      ),

      // --- table (enabled only with the cursor inside a table) ---
      'table.addRowAbove': cmd(
        () => editor.chain().focus().addRowBefore().run(),
        {
          isEnabled: state.inTable,
        },
      ),
      'table.addRowBelow': cmd(
        () => editor.chain().focus().addRowAfter().run(),
        {
          isEnabled: state.inTable,
        },
      ),
      'table.mergeCells': cmd(() => editor.chain().focus().mergeCells().run(), {
        isEnabled: state.canMergeCells,
      }),
      'table.deleteRow': cmd(() => editor.chain().focus().deleteRow().run(), {
        isEnabled: state.inTable,
      }),
      'table.addColumnLeft': cmd(
        () => editor.chain().focus().addColumnBefore().run(),
        { isEnabled: state.inTable },
      ),
      'table.addColumnRight': cmd(
        () => editor.chain().focus().addColumnAfter().run(),
        { isEnabled: state.inTable },
      ),
      'table.deleteColumn': cmd(
        () => editor.chain().focus().deleteColumn().run(),
        {
          isEnabled: state.inTable,
        },
      ),
      'table.toggleHeaderRow': cmd(
        () => editor.chain().focus().toggleHeaderRow().run(),
        { isEnabled: state.inTable },
      ),
      'table.toggleHeaderColumn': cmd(
        () => editor.chain().focus().toggleHeaderColumn().run(),
        { isEnabled: state.inTable },
      ),
      'table.toggleHeaderCell': cmd(
        () => editor.chain().focus().toggleHeaderCell().run(),
        { isEnabled: state.inTable },
      ),
      'table.deleteTable': cmd(
        () => editor.chain().focus().deleteTable().run(),
        {
          isEnabled: state.inTable,
        },
      ),
    };
  }, [editor, state, onError, ipfsImageUploadFn, handleInlineComment]);
};
