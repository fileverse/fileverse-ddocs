import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Label,
  TextField,
} from '@fileverse/ui';
import { Editor } from '@tiptap/core';
import {
  readSpacingSelection,
  uiValueToPercentage,
  percentageToUiValue,
  SPACING_MIN_PT,
  SPACING_MAX_PT,
  type SpacingSelection,
} from '../../utils/typography';

type FieldKey = keyof SpacingSelection;

const clampPt = (text: string): number | null => {
  const trimmed = text.trim();
  // An empty field means "unset" — the CSS default comes back. That is a
  // different outcome from 0, which pins the margin to zero.
  if (trimmed === '') return null;
  const parsed = Number.parseFloat(trimmed);
  if (Number.isNaN(parsed)) return null;
  return Math.min(SPACING_MAX_PT, Math.max(SPACING_MIN_PT, Math.round(parsed)));
};

const toFieldValue = (reading: SpacingSelection[FieldKey], key: FieldKey) => {
  // Blank on mixed. Showing one block's value would let a user hit Apply
  // without touching the field and silently stamp it onto the rest.
  if (reading === 'mixed' || reading === null) return '';
  return key === 'lineHeight'
    ? percentageToUiValue(String(reading))
    : String(reading);
};

export const CustomSpacingDialog = ({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [reading, setReading] = useState<SpacingSelection>({
    spaceBefore: null,
    spaceAfter: null,
    lineHeight: null,
  });
  const [values, setValues] = useState<Record<FieldKey, string>>({
    spaceBefore: '',
    spaceAfter: '',
    lineHeight: '',
  });
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    spaceBefore: false,
    spaceAfter: false,
    lineHeight: false,
  });

  useEffect(() => {
    if (!open) return;
    const next = readSpacingSelection(editor);
    setReading(next);
    setValues({
      spaceBefore: toFieldValue(next.spaceBefore, 'spaceBefore'),
      spaceAfter: toFieldValue(next.spaceAfter, 'spaceAfter'),
      lineHeight: toFieldValue(next.lineHeight, 'lineHeight'),
    });
    setTouched({ spaceBefore: false, spaceAfter: false, lineHeight: false });
  }, [open, editor]);

  // A field left untouched on a mixed selection is not written, so applying
  // one field never flattens the others.
  const shouldWrite = (key: FieldKey) =>
    touched[key] || reading[key] !== 'mixed';

  const apply = () => {
    if (!editor) return;

    const attrs: { spaceBefore?: number | null; spaceAfter?: number | null } =
      {};
    if (shouldWrite('spaceBefore')) {
      attrs.spaceBefore = clampPt(values.spaceBefore);
    }
    if (shouldWrite('spaceAfter')) {
      attrs.spaceAfter = clampPt(values.spaceAfter);
    }

    // One chain, so Apply is a single undo step and a single collab update
    // rather than one per keystroke.
    const chain = editor.chain().focus().setParagraphSpacing(attrs);
    if (shouldWrite('lineHeight')) {
      const raw = values.lineHeight.trim();
      if (raw === '' || Number.isNaN(Number.parseFloat(raw))) {
        chain.unsetLineHeight();
      } else {
        chain.setLineHeight(uiValueToPercentage(raw));
      }
    }
    chain.run();

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[30rem] rounded-2xl gap-4">
        <DialogClose asChild>
          <IconButton
            icon="X"
            size="sm"
            variant="ghost"
            className="absolute right-4 top-3 inline-flex size-6 min-w-0"
          />
        </DialogClose>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>
            <p className="text-heading-sm">Custom spacing</p>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-4">
          <fieldset className="grid gap-3">
            <Label
              htmlFor="lineHeight"
              className="text-heading-xsm leading-normal"
            >
              Line height
            </Label>
            <TextField
              type="number"
              id="lineHeight"
              step={0.05}
              className="buttonless py-2.5 h-10"
              placeholder={reading.lineHeight === 'mixed' ? 'Mixed' : ''}
              value={values['lineHeight']}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setValues((prev) => ({ ...prev, lineHeight: e.target.value }));
                setTouched((prev) => ({ ...prev, lineHeight: true }));
              }}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
              }}
            />
          </fieldset>
          <div>
            <h6 className="text-heading-xsm">Paragraph spacing (pts)</h6>
            <div className="flex gap-4 *:flex-1 mt-3">
              <fieldset className="grid gap-1">
                <Label
                  htmlFor="spaceBefore"
                  className="text-heading-xsm leading-normal color-text-secondary"
                >
                  Before
                </Label>
                <TextField
                  type="number"
                  min={0}
                  max={100}
                  id="spaceBefore"
                  step={1}
                  className="buttonless py-2.5 h-10"
                  placeholder={reading.spaceBefore === 'mixed' ? 'Mixed' : ''}
                  value={values['spaceBefore']}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setValues((prev) => ({
                      ...prev,
                      spaceBefore: e.target.value,
                    }));
                    setTouched((prev) => ({ ...prev, spaceBefore: true }));
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      apply();
                    }
                  }}
                />
              </fieldset>
              <fieldset className="grid gap-1">
                <Label
                  htmlFor="spaceAfter"
                  className="text-heading-xsm leading-normal color-text-secondary"
                >
                  After
                </Label>
                <TextField
                  type="number"
                  id="spaceAfter"
                  step={1}
                  min={0}
                  max={100}
                  className="buttonless py-2.5 h-10"
                  placeholder={reading.spaceAfter === 'mixed' ? 'Mixed' : ''}
                  value={values['spaceAfter']}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setValues((prev) => ({
                      ...prev,
                      spaceAfter: e.target.value,
                    }));
                    setTouched((prev) => ({ ...prev, spaceAfter: true }));
                  }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      apply();
                    }
                  }}
                />
              </fieldset>
            </div>
          </div>
        </div>

        <DialogFooter className="bottom-space-md space-x-md w-full">
          <div className="w-full flex justify-end items-center gap-xsm">
            <DialogClose asChild>
              <Button variant="ghost" className="!min-w-[80px] !w-[80px]">
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={apply} className="!min-w-[80px] !w-[80px]">
              Apply
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
