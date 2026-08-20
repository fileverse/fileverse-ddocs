import { describe, expect, it } from 'vitest';
import { getResponsiveThemeTextColor, getThemeStyle } from './document-styling';

describe('Ultra Dark document styling', () => {
  it('selects an explicit Ultra Dark variant', () => {
    expect(
      getThemeStyle(
        {
          light: '#ffffff',
          dark: '#1e1e1e',
          'theme-ultra-dark': '#0a0a0a',
        },
        'theme-ultra-dark',
      ),
    ).toBe('#0a0a0a');
  });

  it('falls back to the light variant when Ultra Dark is not provided', () => {
    expect(
      getThemeStyle({ light: '#ffffff', dark: '#1e1e1e' }, 'theme-ultra-dark'),
    ).toBe('#ffffff');
  });

  it('makes hard black text readable on Ultra Dark surfaces', () => {
    expect(getResponsiveThemeTextColor('#000000', 'theme-ultra-dark')).toBe(
      '#FFFFFF',
    );
  });
});
