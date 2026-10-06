import { cn, DynamicModal, TextField } from '@fileverse/ui';
import { useState } from 'react';
import { useMediaQuery } from 'usehooks-ts';

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
  const isMobile = useMediaQuery('(max-width: 1000px)', { defaultValue: true });
  const [name, setName] = useState(initialName);

  const submit = () => {
    const nextName = name.trim();
    if (nextName && nextName !== initialName) onConfirm(nextName);
    onClose();
  };

  return (
    <div data-testid="tab-rename-modal">
      <DynamicModal
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        className={cn(
          'gap-md !z-[70]',
          !isMobile && '!w-[400px] border-radius-lg',
        )}
        contentClassName="!pt-4 !pb-0 space-x-md"
        title={<p className="text-heading-sm">Rename tab</p>}
        content={
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
        }
        primaryAction={{
          className: 'w-full md:w-auto',
          label: 'Done',
          onClick: submit,
        }}
        secondaryAction={{
          className: 'w-full md:w-auto',
          label: 'Cancel',
          onClick: onClose,
          variant: 'secondary',
        }}
      />
    </div>
  );
};
