import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  LucideIcon,
} from '@fileverse/ui';
import { useEditorMediaQuery } from '../../hooks/use-editor-media-query';

export const DeleteConfirmOverlay = ({
  isVisible,
  title,
  onCancel,
  onConfirm,
  className,
  heading = 'Delete comment',
  description,
  confirmLabel = 'Delete',
}: {
  isVisible: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  className?: string;
  heading?: string;
  description?: string;
  confirmLabel?: string;
}) => {
  const isMobile = useEditorMediaQuery('(max-width: 1000px)');
  const resolvedDescription =
    description ?? 'Do you really want to delete this comment?';

  if (!isVisible) {
    return null;
  }

  return isMobile ? (
    <Dialog
      open={isVisible}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onCancel();
        }
      }}
    >
      <DialogContent
        className={cn(' !max-w-[336px]  border-radius-xlg ## !rounded-[16px]')}
        dismissable={false}
      >
        <DialogHeader className="space-md border-b-[1px]">
          <DialogTitle className="">
            <div className="flex items-center gap-4">
              <LucideIcon
                stroke="#FB3449"
                name="Info"
                className="h-[18px] w-[18px]"
              />
              <p className="text-heading-sm">{heading}</p>
            </div>
          </DialogTitle>
        </DialogHeader>
        <p className="text-body-sm px-[16px] color-text-default">
          {resolvedDescription}
        </p>

        <DialogFooter className="bottom-space-md space-x-md mt-[16px]  w-full">
          <div className="w-full flex justify-end items-center gap-xsm">
            <DialogClose asChild>
              <Button
                variant={'ghost'}
                className=" !min-w-[80px] !w-[80px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onConfirm();
              }}
              variant={'danger'}
              className="!min-w-[80px] !w-[80px]"
            >
              {confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : (
    <div
      className={cn(
        'absolute inset-0 z-10 flex flex-col rounded-[12px] items-center justify-center gap-[12px] bg-black/75',
        className,
      )}
    >
      <p className="color-text-inverse text-heading-xsm">{title}</p>
      {description && (
        <p className="px-[16px] text-center text-body-sm color-text-inverse">
          {description}
        </p>
      )}
      <div className="flex gap-[8px]">
        <Button
          className="!min-w-[80px] color-text-inverse hover:text-black !h-[30px] !w-[80px]"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          className="!min-w-[80px] !h-[30px] !w-[80px]"
          variant="danger"
          onClick={(e) => {
            e.stopPropagation();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
};
