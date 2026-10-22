import { cn, DynamicModal, LucideIcon } from '@fileverse/ui';
import { ReactNode } from 'react';
import { useMediaQuery } from 'usehooks-ts';

interface IConfirmDeleteModalProps {
  onClose: () => void;
  onConfirm: () => void;
  isOpen: boolean;
  documentTitle: string;
  isLoading: boolean;
  text?: string | ReactNode;
  title?: string;
  overlayClasses?: string;
  noOverlay?: boolean;

  primaryLabel?: string;
  secondaryLabel?: string;
  hasCloseIcon?: boolean;
  hideTitleIcon?: boolean;
}

export const ConfirmDeleteModal = ({
  onClose,
  onConfirm,
  isOpen,
  isLoading,
  title,
  overlayClasses,
  noOverlay,
  hasCloseIcon,
  primaryLabel,
  hideTitleIcon,
  text,
}: IConfirmDeleteModalProps) => {
  const isMobile = useMediaQuery('(max-width: 1000px)', { defaultValue: true });

  return (
    <div data-testid="tab-delete-modal">
      <DynamicModal
        open={isOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isLoading) {
            onClose();
          }
        }}
        hasCloseIcon={hasCloseIcon}
        className={cn(
          'gap-md !z-[70]',
          !isMobile && '!w-[400px] border-radius-lg',
        )}
        contentClassName="!pt-4 !pb-0 space-x-md"
        overlayClasses={overlayClasses}
        noOverlay={noOverlay}
        content={
          <p className="text-body-sm color-text-default">
            {text || 'This tab and the content within it will be deleted'}
          </p>
        }
        primaryAction={{
          className: 'w-full md:w-auto confirm-delete-btn',
          label: primaryLabel || 'Delete',
          onClick: () => {
            if (!isLoading) {
              onConfirm();
            }
          },
          variant: 'danger',
          isLoading: isLoading,
        }}
        secondaryAction={{
          className: `w-full md:w-auto ${isLoading ? 'cursor-not-allowed' : ''}`,
          label: 'Cancel',
          onClick: () => {
            if (!isLoading) {
              onClose();
            }
          },
          variant: 'ghost',
        }}
        disableOutsideClick
        title={
          <div className="flex items-center gap-sm">
            {!hideTitleIcon && (
              <LucideIcon
                name="Trash2"
                stroke="#FB3449"
                className="h-[18px] w-[18px]"
              />
            )}
            <p className="text-heading-sm">{title || 'Delete this tab?'}</p>
          </div>
        }
      />
    </div>
  );
};
