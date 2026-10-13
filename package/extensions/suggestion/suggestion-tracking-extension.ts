/**
 * SuggestionTrackingExtension
 *
 * Intercepts viewer keystrokes in suggestion mode and routes them to the
 * Zustand store as pending-draft actions. The ProseMirror document is never
 * modified by this extension — typed text is captured as a proposed change,
 * rendered as a decoration overlay via the draft anchor layer.
 *
 * Design: props-based plugin (handleKeyDown, handleTextInput, handlePaste,
 * handleDrop). Each handler returns true to block the default behavior when
 * suggestion mode is active; the extension never dispatches a doc-modifying
 * transaction. The only path that modifies the doc in the entire suggestion
 * system is applyAcceptedSuggestion on owner Accept.
 *
 * See docs/architecture/suggestion-mode-architecture.md for the full model.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import * as Y from 'yjs';
import { SuggestionType } from '../../types';
import type { CommentAnchor } from '../comment/comment-decoration-plugin';

// ---------------------------------------------------------------------------
// Public types — kept for downstream import compatibility. SuggestionReadyData
// is unused by the new model (submit goes through the store, not a TipTap
// command) but exported so consumers that reference the type still compile.
// ---------------------------------------------------------------------------

export interface SuggestionReadyData {
  suggestionId: string;
  anchorFrom: Y.RelativePosition;
  anchorTo: Y.RelativePosition;
  suggestionType: SuggestionType;
  originalContent: string;
  suggestedContent: string;
}

export interface SuggestionTrackingOptions {
  /** Returns true when the editor is in suggestion mode. */
  getIsSuggestionMode: () => boolean;

  /** Viewer types text with a collapsed cursor (Add gesture). */
  onTextInput: (text: string) => void;
  /** Enter or Shift+Enter may contribute a proposed break, never a doc edit. */
  onBreak: (shift: boolean) => void;

  /** Viewer types text over a non-empty selection (Replace gesture). */
  onReplaceTyping: (from: number, to: number, text: string) => void;

  /** Viewer presses Backspace/Delete with a non-empty selection. */
  onDeleteSelection: (from: number, to: number) => void;

  /** Viewer pastes a link over selected text. */
  onPasteLink: (from: number, to: number, href: string) => void;

  /** Viewer attempted an unsupported paste/drop in suggestion mode. */
  onUnsupportedPaste?: () => void;

  /**
   * Viewer presses Backspace/Delete with a collapsed cursor.
   * The consumer decides whether this should shrink an active draft or create
   * a new one-character delete suggestion at the caret.
   */
  onDeleteAtCursor: (direction: 'backward' | 'forward') => void;

  /**
   * Browser attempted to delete a concrete range without an explicit
   * user selection (for example, a beforeinput/IME path that bypassed
   * keydown). Lets the consumer preserve "undo active draft" semantics
   * while still creating delete drafts for normal text.
   */
  onDeleteRangeWithoutSelection: (from: number, to: number) => void;

  /** Viewer presses Cmd+Z (or Ctrl+Z). Shrinks the active draft by one keystroke. */
  onUndo: () => void;

  // Legacy — unused by the new model, retained as optional for backwards
  // compatibility with any consumer that still passes them.
  onLiveSuggestion?: ((anchor: CommentAnchor) => void) | null;
  onSuggestionReady?: ((data: SuggestionReadyData) => void) | null;
}

// ---------------------------------------------------------------------------
// Plugin key — exposed so provider / debug tooling can set transaction metas
// that this plugin should ignore (e.g. cursor-only adjustments). Currently
// the plugin doesn't read meta; the key is reserved for future use.
// ---------------------------------------------------------------------------

export const suggestionTrackingPluginKey = new PluginKey<null>(
  'suggestionTracking',
);

/**
 * Meta key set on transactions that toggle a heading's `isCollapsed` attribute.
 * Such transactions are UI-state changes (folding/unfolding sections), not
 * content edits — `filterTransaction` lets them through in suggest mode.
 */
export const HEADING_COLLAPSE_TOGGLE_META = 'heading-collapse-toggle';

// ---------------------------------------------------------------------------
// Keystroke classification helpers
// ---------------------------------------------------------------------------

function isFormattingShortcut(event: KeyboardEvent): boolean {
  // Cmd/Ctrl + B / I / U — bold, italic, underline. Shift+... for strike in
  // some bindings; block that conservatively too.
  const isMod = event.metaKey || event.ctrlKey;
  if (!isMod) return false;
  const key = event.key.toLowerCase();
  return key === 'b' || key === 'i' || key === 'u';
}

function isUndoShortcut(event: KeyboardEvent): boolean {
  const isMod = event.metaKey || event.ctrlKey;
  return isMod && !event.shiftKey && event.key.toLowerCase() === 'z';
}

function isRedoShortcut(event: KeyboardEvent): boolean {
  // Cmd+Shift+Z (mac) and Cmd+Y (win). Also Ctrl+Y.
  const isMod = event.metaKey || event.ctrlKey;
  if (!isMod) return false;
  const key = event.key.toLowerCase();
  return (event.shiftKey && key === 'z') || key === 'y';
}

function isCutShortcut(event: KeyboardEvent): boolean {
  const isMod = event.metaKey || event.ctrlKey;
  return isMod && event.key.toLowerCase() === 'x';
}

function getBeforeInputTargetRange(
  view: EditorView,
  event: InputEvent,
): { from: number; to: number } | null {
  const ranges =
    typeof event.getTargetRanges === 'function' ? event.getTargetRanges() : [];
  const range = ranges[0];

  if (!range) {
    return null;
  }

  try {
    const from = view.posAtDOM(range.startContainer, range.startOffset);
    const to = view.posAtDOM(range.endContainer, range.endOffset);

    return {
      from: Math.min(from, to),
      to: Math.max(from, to),
    };
  } catch {
    return null;
  }
}

function hasNonCollapsedDomSelection(view: EditorView): boolean {
  const selection = window.getSelection();

  if (!selection || selection.isCollapsed) {
    return false;
  }

  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;

  return Boolean(
    anchorNode &&
      focusNode &&
      view.dom.contains(anchorNode) &&
      view.dom.contains(focusNode),
  );
}

function normalizePastedHref(text: string): string | null {
  const href = text.trim();
  if (!href || /\s/.test(href) || href.includes('@')) {
    return null;
  }

  const urlPattern = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\.?(:\d+)?(\/\S*)?$/i;

  if (!urlPattern.test(href)) {
    return null;
  }

  return href.startsWith('http://') || href.startsWith('https://')
    ? href
    : `https://${href}`;
}

function hasClipboardFile(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.files?.length) {
    return true;
  }

  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === 'file',
  );
}

function getSingleLinePlainText(
  dataTransfer: DataTransfer | null | undefined,
): string | null {
  // Suggestion paste v1 intentionally accepts only plain, single-line text.
  // Files, multiline text, and rich clipboard payloads stay blocked so the
  // immutable suggestion-mode document cannot be changed through PM fallback.
  if (!dataTransfer || hasClipboardFile(dataTransfer)) {
    return null;
  }

  const text = dataTransfer.getData('text/plain');

  if (!text || text.trim().length === 0 || /[\r\n]/.test(text)) {
    return null;
  }

  return text;
}

function routePlainTextPaste(
  opts: SuggestionTrackingOptions,
  from: number,
  to: number,
  text: string,
) {
  // Preserve the existing selected-text + URL gesture as a link suggestion;
  // all other accepted plain text becomes add/replace suggestion content.
  const pastedHref = normalizePastedHref(text);

  if (from < to && pastedHref) {
    opts.onPasteLink(from, to, pastedHref);
    return;
  }

  if (from < to) {
    opts.onReplaceTyping(from, to, text);
    return;
  }

  opts.onTextInput(text);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const SuggestionTrackingExtension =
  Extension.create<SuggestionTrackingOptions>({
    name: 'suggestionTracking',
    priority: 1001,

    addOptions() {
      return {
        getIsSuggestionMode: () => false,
        onTextInput: () => {},
        onBreak: () => {},
        onReplaceTyping: () => {},
        onDeleteSelection: () => {},
        onPasteLink: () => {},
        onUnsupportedPaste: () => {},
        onDeleteAtCursor: () => {},
        onDeleteRangeWithoutSelection: () => {},
        onUndo: () => {},
        onLiveSuggestion: null,
        onSuggestionReady: null,
      };
    },

    addProseMirrorPlugins() {
      const getOptions = () => this.options;

      return [
        new Plugin({
          key: suggestionTrackingPluginKey,

          // Safety net: some deletion paths (double-click word select +
          // Backspace, IME delete, beforeinput-driven deletions) bypass
          // handleKeyDown and handleDOMEvents entirely. filterTransaction
          // catches EVERY transaction before dispatch — if one is about to
          // modify the doc while in suggest mode, we cancel it and schedule
          // the matching draft action.
          filterTransaction(tr, state) {
            const opts = getOptions();
            if (!opts.getIsSuggestionMode()) return true;
            if (!tr.docChanged) return true;
            if (tr.getMeta(suggestionTrackingPluginKey)) return true;
            if (tr.getMeta('y-sync$')) return true;
            // Heading collapse is a UI-state attribute toggle, not a content
            // edit — allow it through even in suggest mode.
            if (tr.getMeta(HEADING_COLLAPSE_TOGGLE_META)) return true;

            // Pre-transaction selection tells us whether the user had a
            // range selected. Without a selection, we still need the
            // pre-change state so the consumer can decide between shrinking
            // an active draft and creating a delete suggestion.
            const hadSelection = state.selection.from < state.selection.to;

            // Classify the transaction by inspecting its steps:
            //   - deletedRange: a pure text-range deletion
            //   - insertedText: pure text content being inserted
            //   - hasStructuralChange: boundaries / node splits / non-ReplaceSteps
            // Enter, Tab, paste-with-structure, drag, etc. produce structural
            // changes — we block those silently (no draft action).
            let deletedRange: { from: number; to: number } | null = null;
            let insertedText = '';
            let hasStructuralChange = false;

            for (const step of tr.steps) {
              if (!(step instanceof ReplaceStep)) {
                hasStructuralChange = true;
                continue;
              }
              if (step.slice.openStart > 0 || step.slice.openEnd > 0) {
                hasStructuralChange = true;
              }
              if (step.from < step.to) {
                deletedRange = { from: step.from, to: step.to };
              }
              if (step.slice.size > 0) {
                insertedText += step.slice.content.textBetween(
                  0,
                  step.slice.content.size,
                  '',
                );
              }
            }

            // Structural changes (Enter, Tab, paste-with-blocks, node splits)
            // are blocked silently per spec ("blocked gestures simply do nothing").
            if (hasStructuralChange) {
              return false;
            }

            // Pure text change: translate to a draft action.
            if (deletedRange || insertedText) {
              setTimeout(() => {
                if (deletedRange && insertedText) {
                  opts.onReplaceTyping(
                    deletedRange.from,
                    deletedRange.to,
                    insertedText,
                  );
                } else if (deletedRange && hadSelection) {
                  // User selected text and pressed Backspace/Delete
                  opts.onDeleteSelection(deletedRange.from, deletedRange.to);
                } else if (deletedRange) {
                  // A browser path deleted a concrete range without an
                  // explicit selection. Let the consumer decide whether to
                  // undo an active draft or promote this into a delete draft.
                  opts.onDeleteRangeWithoutSelection(
                    deletedRange.from,
                    deletedRange.to,
                  );
                } else if (insertedText) {
                  opts.onTextInput(insertedText);
                }
              }, 0);
            }

            // Always block any doc-changing transaction in suggest mode — the
            // document is only modified on owner Accept.
            return false;
          },

          props: {
            // ----- Text input ------------------------------------------------
            // Fires for ordinary typing (including post-composition IME commit).
            // If a selection is active, treat as Replace gesture; otherwise Add.
            handleTextInput(_view, from, to, text) {
              const opts = getOptions();
              if (!opts.getIsSuggestionMode()) return false;

              if (from < to) {
                opts.onReplaceTyping(from, to, text);
              } else {
                opts.onTextInput(text);
              }
              return true;
            },

            // ----- Key down --------------------------------------------------
            // Handle non-text keys: Backspace/Delete, Enter, Tab, Cmd+Z, blocked
            // shortcuts. Return true for anything we want to block or intercept.
            handleKeyDown(view, event) {
              const opts = getOptions();
              if (!opts.getIsSuggestionMode()) return false;

              const { from, to } = view.state.selection;

              // Backspace / Delete:
              //   - with selection → Delete draft
              //   - without selection → consumer decides between shrinking
              //     the active draft and creating a new delete suggestion at
              //     the cursor.
              if (event.key === 'Backspace' || event.key === 'Delete') {
                if (from < to) {
                  opts.onDeleteSelection(from, to);
                } else {
                  opts.onDeleteAtCursor(
                    event.key === 'Backspace' ? 'backward' : 'forward',
                  );
                }
                return true;
              }

              if (event.key === 'Enter') {
                opts.onBreak(event.shiftKey);
                return true;
              }
              if (event.key === 'Tab') {
                return true;
              }

              // Escape — no-op but block to be explicit
              if (event.key === 'Escape') {
                return true;
              }

              // Cmd+Z — shrink active draft; block default editor undo
              if (isUndoShortcut(event)) {
                opts.onUndo();
                return true;
              }

              // Cmd+Shift+Z / Cmd+Y — redo blocked in v1
              if (isRedoShortcut(event)) {
                return true;
              }

              // Formatting shortcuts — blocked (v1 tracks content only)
              if (isFormattingShortcut(event)) {
                return true;
              }

              // Cut — blocked (would remove text from the doc)
              if (isCutShortcut(event)) {
                return true;
              }

              // Everything else (navigation, Cmd+A, Cmd+C, etc.) — let PM handle
              return false;
            },

            // ----- Paste / Drop ---------------------------------------------
            // In suggestion mode, plain single-line text paste is captured as
            // a suggestion draft. The document still stays immutable.
            handlePaste(view, event) {
              const opts = getOptions();
              if (!opts.getIsSuggestionMode()) return false;

              event.preventDefault();
              const { from, to } = view.state.selection;
              const pastedText = getSingleLinePlainText(event.clipboardData);

              if (pastedText) {
                routePlainTextPaste(opts, from, to, pastedText);
              } else {
                opts.onUnsupportedPaste?.();
              }

              return true;
            },
            handleDrop(_view, event) {
              const opts = getOptions();
              if (!opts.getIsSuggestionMode()) return false;

              event.preventDefault();
              opts.onUnsupportedPaste?.();
              return true;
            },

            // ----- DOM beforeinput — catches deletion paths that bypass
            // handleKeyDown (browser-native selection + Backspace on some
            // browsers fires only beforeinput, not keydown).
            handleDOMEvents: {
              beforeinput: (view, event) => {
                const opts = getOptions();
                if (!opts.getIsSuggestionMode()) return false;

                const inputType = event.inputType;
                const targetRange = getBeforeInputTargetRange(view, event);
                const hasTargetRange = Boolean(
                  targetRange && targetRange.from < targetRange.to,
                );

                // Selection deletion: capture selection before browser mutates
                if (
                  inputType === 'deleteContentBackward' ||
                  inputType === 'deleteContentForward' ||
                  inputType === 'deleteWordBackward' ||
                  inputType === 'deleteWordForward' ||
                  inputType === 'deleteByCut' ||
                  inputType === 'deleteByDrag'
                ) {
                  const { from, to } = view.state.selection;
                  if (from < to) {
                    event.preventDefault();
                    opts.onDeleteSelection(from, to);
                    return true;
                  }

                  if (targetRange && hasTargetRange) {
                    event.preventDefault();
                    if (hasNonCollapsedDomSelection(view)) {
                      opts.onDeleteSelection(targetRange.from, targetRange.to);
                    } else {
                      opts.onDeleteRangeWithoutSelection(
                        targetRange.from,
                        targetRange.to,
                      );
                    }
                    return true;
                  }

                  // Simple collapsed-caret delete paths should behave the
                  // same as keydown. Wider-range browser deletes (word/cut/
                  // drag) fall through so filterTransaction can inspect the
                  // actual deleted range and convert it into a draft.
                  if (inputType === 'deleteContentBackward') {
                    event.preventDefault();
                    opts.onDeleteAtCursor('backward');
                    return true;
                  }

                  if (inputType === 'deleteContentForward') {
                    event.preventDefault();
                    opts.onDeleteAtCursor('forward');
                    return true;
                  }

                  return false;
                }

                if (inputType === 'insertText') {
                  const text = event.data ?? '';
                  if (!text) {
                    return false;
                  }

                  const { from, to } = view.state.selection;
                  event.preventDefault();

                  if (from < to) {
                    opts.onReplaceTyping(from, to, text);
                    return true;
                  }

                  if (targetRange && hasTargetRange) {
                    opts.onReplaceTyping(
                      targetRange.from,
                      targetRange.to,
                      text,
                    );
                    return true;
                  }

                  opts.onTextInput(text);
                  return true;
                }

                // Paste routes through beforeinput too on some browsers.
                if (inputType === 'insertFromPaste') {
                  event.preventDefault();
                  const pastedText = getSingleLinePlainText(
                    (
                      event as InputEvent & {
                        dataTransfer?: DataTransfer | null;
                      }
                    ).dataTransfer,
                  );
                  const { from, to } = view.state.selection;
                  if (pastedText) {
                    routePlainTextPaste(
                      opts,
                      targetRange && hasTargetRange ? targetRange.from : from,
                      targetRange && hasTargetRange ? targetRange.to : to,
                      pastedText,
                    );
                  } else {
                    opts.onUnsupportedPaste?.();
                  }
                  return true;
                }

                if (
                  inputType === 'insertFromPasteAsQuotation' ||
                  inputType === 'insertFromDrop' ||
                  inputType === 'insertReplacementText'
                ) {
                  event.preventDefault();
                  opts.onUnsupportedPaste?.();
                  return true;
                }

                // insertText / insertCompositionText — let handleTextInput
                // deal with it. Return false so PM continues processing.
                return false;
              },
            },
          },
        }),
      ];
    },
  });
