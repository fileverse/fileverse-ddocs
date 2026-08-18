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
 * The Google Docs "Add / Remove space before|after paragraph" pair, shared by
 * the toolbar dropdown and the bubble menu so the label logic exists once.
 *
 * The label reflects what the block actually renders with, stylesheet
 * included, so a fresh paragraph offers "Remove" first — its gap comes from
 * editor.css rather than from an attribute.
 *
 * Both halves write an explicit value. Removing writes 0, because null hands
 * the block back to the stylesheet — the very gap being removed. Adding writes
 * SPACING_ADD_PT for the mirror-image reason: "Add" is only offered when the
 * stylesheet already gives nothing, so null would leave it at zero.
 */
export const getSpacingToggles = (editor: Editor | null): SpacingToggle[] => {
  const effective = readEffectiveSpacing(editor);

  const build = (
    edge: 'before' | 'after',
    reading: SpacingReading<number>,
    attribute: 'spaceBefore' | 'spaceAfter',
  ): SpacingToggle => {
    const action = spacingToggleAction(reading);
    return {
      edge,
      label: `${action === 'add' ? 'Add' : 'Remove'} space ${edge} paragraph`,
      onSelect: () =>
        editor
          ?.chain()
          .focus()
          .setParagraphSpacing({
            [attribute]: action === 'add' ? SPACING_ADD_PT : 0,
          })
          .run(),
    };
  };

  return [
    build('before', effective.spaceBefore, 'spaceBefore'),
    build('after', effective.spaceAfter, 'spaceAfter'),
  ];
};
