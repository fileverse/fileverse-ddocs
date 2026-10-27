import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomProvider } from '../../hooks/use-zoom';
import type { ZoomLevel } from '../../utils/zoom';
import { ZoomLevelDropdown } from './zoom-level';

vi.mock('@fileverse/ui', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    LucideIcon: () => null,
    DropdownMenu: Wrapper,
    DropdownMenuTrigger: Wrapper,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="menu">{children}</div>
    ),
    DropdownMenuItem: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
  };
});

const renderAt = (zoomLevel: ZoomLevel, setZoomLevel = vi.fn()) => {
  render(
    <ZoomProvider
      zoomLevel={zoomLevel}
      fitScale={1}
      scale={1}
      setZoomLevel={setZoomLevel}
    >
      <ZoomLevelDropdown />
    </ZoomProvider>,
  );
  return setZoomLevel;
};

describe('ZoomLevelDropdown', () => {
  it('labels fit and 125%', () => {
    renderAt('fit');
    expect(screen.getAllByText('Fit')[0].closest('button')).toBe(
      screen.getAllByRole('button')[0],
    );
  });

  it('shows 125% on the trigger', () => {
    renderAt('1.25');
    expect(screen.getAllByRole('button')[0].textContent).toBe('125%');
  });

  it('lists the seven presets in order and sets the choice', () => {
    const setZoomLevel = renderAt('1');
    const items = Array.from(
      screen.getByTestId('menu').querySelectorAll('button'),
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'Fit',
      '50%',
      '75%',
      '100%',
      '125%',
      '150%',
      '200%',
    ]);
    fireEvent.click(items[4]);
    expect(setZoomLevel).toHaveBeenCalledWith('1.25');
  });
});
