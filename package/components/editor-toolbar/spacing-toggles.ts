import { Editor } from '@tiptap/core';
import {
  readEffectiveSpacing,
  SPACING_ADD_PT,
  spacingToggleAction,
  type SpacingReading,
} from '../../utils/typography';

export type SpacingToggle = {
  edge: 'before' | 'after';
  label: string;
  onSelect: () => void;
};

/**
 * Write one half of the toggle.
 *
 * Both halves write an explicit value. Removing writes 0, because null hands
 * the block back to the stylesheet — the very gap being removed. Adding writes
 * SPACING_ADD_PT for the mirror-image reason: "Add" is only offered when the
 * stylesheet already gives nothing, so null would leave it at zero.
 *
 * Exported so the second-level nav's registry entry writes exactly what the
 * toolbar dropdown and bubble menu write, without rebuilding the toggle list.
 */
export const applySpacingToggle = (
  editor: Editor | null,
  edge: 'before' | 'after',
  action: 'add' | 'remove',
) =>
  editor
    ?.chain()
    .focus()
    .setParagraphSpacing({
      [edge === 'before' ? 'spaceBefore' : 'spaceAfter']:
        action === 'add' ? SPACING_ADD_PT : 0,
    })
    .run();

/** The menu wording for one half, shared so every surface reads identically. */
export const spacingToggleLabel = (
  edge: 'before' | 'after',
  action: 'add' | 'remove',
) => `${action === 'add' ? 'Add' : 'Remove'} space ${edge} paragraph`;

/**
 * The Google Docs "Add / Remove space before|after paragraph" pair, shared by
 * the toolbar dropdown and the bubble menu so the label logic exists once.
 *
 * The label reflects what the block actually renders with, stylesheet
 * included, so a fresh paragraph offers "Remove" first — its gap comes from
 * editor.css rather than from an attribute.
 */
export const getSpacingToggles = (editor: Editor | null): SpacingToggle[] => {
  const effective = readEffectiveSpacing(editor);

  const build = (
    edge: 'before' | 'after',
    reading: SpacingReading<number>,
  ): SpacingToggle => {
    const action = spacingToggleAction(reading);
    return {
      edge,
      label: spacingToggleLabel(edge, action),
      onSelect: () => applySpacingToggle(editor, edge, action),
    };
  };

  return [
    build('before', effective.spaceBefore),
    build('after', effective.spaceAfter),
  ];
};
