import {
  DynamicDropdownV2,
  IconButton,
  LucideIcon,
  Tooltip,
} from '@fileverse/ui';
import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { DdocProps } from '../types';
import { zoomLevels } from '../constants/zoom';

type FullScreenToolbarProps = {
  dropdownOpen: boolean;
  setDropdownOpen: Dispatch<SetStateAction<boolean>>;
  zoomLevel: string;
  setZoomLevel: Dispatch<SetStateAction<string>>;
  showTOC: DdocProps['showTOC'];
  setShowTOC: DdocProps['setShowTOC'];
  toggleFocusMode: () => Promise<void>;
};

export const FullScreenToolbar = ({
  dropdownOpen,
  setDropdownOpen,
  zoomLevel,
  setZoomLevel,
  showTOC,
  setShowTOC,
  toggleFocusMode,
}: FullScreenToolbarProps) => {
  useEffect(() => {
    setShowTOC?.(false);
  }, []);
  return (
    <div className="fixed right-[24px] z-[9] items-center flex gap-[4px] top-[24px]">
      <DynamicDropdownV2
        key="zoom-levels"
        align="start"
        sideOffset={8}
        controlled={true}
        isOpen={dropdownOpen}
        onClose={() => setDropdownOpen(false)}
        anchorTrigger={
          <button
            className="bg-transparent hover:!color-bg-default-hover rounded p-2 h-[30px] flex items-center justify-center gap-2 w-[78px]"
            onClick={() => {
              setDropdownOpen((prev) => !prev);
            }}
          >
            <span className="text-body-sm-bold line-clamp-1 w-fit">
              {zoomLevels.find((z) => z.value === zoomLevel)?.title || '100%'}
            </span>
            <LucideIcon name="ChevronDown" size="sm" />
          </button>
        }
        content={
          <div className="zoom-level-options w-[110px] text-body-sm scroll-smooth color-bg-default px-1 py-2 shadow-elevation-3 transition-all rounded">
            {zoomLevels.map((zoom) => (
              <button
                key={zoom.title}
                className="hover:color-bg-default-hover h-8 rounded py-1 px-2 w-full text-left flex items-center space-x-2 text-sm color-text-default transition"
                onClick={() => {
                  setZoomLevel(zoom.value);
                  setDropdownOpen(false);
                }}
              >
                {zoom.title}
              </button>
            ))}
          </div>
        }
      />
      <Tooltip
        text={
          showTOC
            ? 'Hide tabs and outlines sidebar'
            : 'Show tabs and outlines sidebar'
        }
        position={'bottom'}
        asTriggerChild
      >
        <IconButton
          icon={'List'}
          size="sm"
          variant="ghost"
          className="!w-[30px] !h-[30px] !min-w-[30px] disabled:bg-transparent"
          onClick={() => setShowTOC?.((prev) => !prev)}
        />
      </Tooltip>

      <Tooltip text="Exit focus mode">
        <IconButton
          icon={'Minimize'}
          size="sm"
          variant="ghost"
          onClick={toggleFocusMode}
          className="!w-[30px] !h-[30px] !min-w-[30px] disabled:bg-transparent"
        />
      </Tooltip>
    </div>
  );
};
