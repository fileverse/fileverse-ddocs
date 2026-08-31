import { describe, it, expect } from 'vitest';
import { DOCX_STYLE_MAP } from './docx-import';

describe('DOCX_STYLE_MAP', () => {
  it('contains rule for underline', () => {
    expect(DOCX_STYLE_MAP).toContain('u => u');
  });

  it('contains rules for all 16 OOXML highlight colors mapped to hex', () => {
    const expectedColors = [
      "highlight[color='yellow'] => mark[data-color='#FFFF00']",
      "highlight[color='green'] => mark[data-color='#00FF00']",
      "highlight[color='cyan'] => mark[data-color='#00FFFF']",
      "highlight[color='magenta'] => mark[data-color='#FF00FF']",
      "highlight[color='red'] => mark[data-color='#FF0000']",
      "highlight[color='blue'] => mark[data-color='#0000FF']",
      "highlight[color='darkBlue'] => mark[data-color='#00008B']",
      "highlight[color='darkCyan'] => mark[data-color='#008B8B']",
      "highlight[color='darkGreen'] => mark[data-color='#006400']",
      "highlight[color='darkMagenta'] => mark[data-color='#8B008B']",
      "highlight[color='darkRed'] => mark[data-color='#8B0000']",
      "highlight[color='darkYellow'] => mark[data-color='#808000']",
      "highlight[color='darkGray'] => mark[data-color='#A9A9A9']",
      "highlight[color='lightGray'] => mark[data-color='#D3D3D3']",
      "highlight[color='black'] => mark[data-color='#000000']",
      'highlight => mark',
    ];

    for (const rule of expectedColors) {
      expect(DOCX_STYLE_MAP).toContain(rule);
    }
  });
});
