import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  LucideIcon,
} from '@fileverse/ui';
import cn from 'classnames';

// Fixed values on purpose — a backdrop exists to keep a transparent image
// readable regardless of theme, so it must NOT flip with dark mode the way
// the theme-aware text palette does.
const BACKGROUND_SWATCHES = [
  { name: 'White', value: '#FFFFFF' },
  { name: 'Off-white', value: '#F5F6F8' },
  { name: 'Light gray', value: '#E5E5E5' },
  { name: 'Dark gray', value: '#262626' },
  { name: 'Black', value: '#000000' },
];

const normalizeHex = (raw: string): string | null => {
  const hex = raw.trim().replace(/^#/, '');
  return /^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? `#${hex}` : null;
};

export const MediaBackgroundPicker = ({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
}) => {
  const [customInput, setCustomInput] = useState('');

  const applyCustom = () => {
    const hex = normalizeHex(customInput);
    if (hex) onChange(hex);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon="PaintBucket"
          variant="ghost"
          size="sm"
          className={cn(
            'min-w-6 aspect-square',
            value && 'color-bg-default-hover',
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="p-0 b-0">
        <div className="h-auto rounded color-bg-default px-3 py-3 shadow-elevation-3 max-w-fit">
          <div className="flex gap-1">
            <DropdownMenuItem
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(null)}
              className="w-5 h-5 p-0 rounded-full flex justify-center items-center cursor-pointer border color-border-default"
            >
              <LucideIcon name="Ban" className="w-[14px] aspect-square" />
            </DropdownMenuItem>
            {BACKGROUND_SWATCHES.map((swatch) => (
              <DropdownMenuItem
                key={swatch.value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(swatch.value)}
                className="w-5 h-5 p-0 rounded-full flex justify-center items-center cursor-pointer border color-border-default ease-in duration-200 data-[highlighted]:scale-[1.05]"
                style={{ backgroundColor: swatch.value }}
              >
                <LucideIcon
                  name="Check"
                  className={cn(
                    'w-[14px] aspect-square',
                    value?.toUpperCase() === swatch.value
                      ? 'visible'
                      : 'invisible',
                    ['#262626', '#000000'].includes(swatch.value)
                      ? 'text-white'
                      : 'text-black',
                  )}
                />
              </DropdownMenuItem>
            ))}
          </div>
          <div className="flex gap-1 mt-2">
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyCustom();
                }
                e.stopPropagation();
              }}
              placeholder="#RRGGBB"
              className="w-24 px-2 py-1 text-helper-text-sm rounded border color-border-default color-bg-default color-text-default outline-none"
            />
            <IconButton
              icon="Check"
              variant="ghost"
              size="sm"
              className="min-w-6"
              onClick={applyCustom}
            />
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
