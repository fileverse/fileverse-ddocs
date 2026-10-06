import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  TextField,
} from '@fileverse/ui';
import { useState } from 'react';

interface RenameTabModalProps {
  isOpen: boolean;
  initialName: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}

export const RenameTabModal = ({
  isOpen,
  initialName,
  onClose,
  onConfirm,
}: RenameTabModalProps) => {
  const [name, setName] = useState(initialName);

  const submit = () => {
    const nextName = name.trim();
    if (nextName && nextName !== initialName) onConfirm(nextName);
    onClose();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="tab-rename-modal"
        className="!max-w-[25rem] rounded-2xl gap-4"
      >
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
            <p className="text-heading-sm">Rename tab</p>
          </DialogTitle>
        </DialogHeader>

        <div className="space-x-md">
          <TextField
            data-testid="tab-rename-modal-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </div>

        <DialogFooter className="bottom-space-md space-x-md w-full">
          <div className="w-full flex justify-end items-center gap-xsm">
            <Button
              variant="secondary"
              onClick={onClose}
              className="!min-w-[80px] !w-[80px]"
            >
              Cancel
            </Button>
            <Button onClick={submit} className="!min-w-[80px] !w-[80px]">
              Done
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
