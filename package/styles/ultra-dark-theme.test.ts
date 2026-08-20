import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = fs.readFileSync(path.join(__dirname, 'index.css'), 'utf8');
const ultraDarkBlock = stylesheet
  .split('.theme-ultra-dark {')
  .at(-1)
  ?.split('}')[0];

const grayToken = (name: string): number => {
  const match = ultraDarkBlock?.match(
    new RegExp(`${name}:\\s*0,\\s*0%,\\s*(\\d+)%,\\s*1`),
  );
  if (!match) throw new Error(`Missing ${name}`);
  return Math.round((Number(match[1]) / 100) * 255);
};

const luminance = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
};

const contrast = (foreground: number, background: number): number => {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

describe('Ultra Dark theme tokens', () => {
  it('defines the hosted preview canvas color', () => {
    expect(stylesheet).toMatch(
      /\.theme-ultra-dark\s*\{[\s\S]*--color-bg-default:\s*0,\s*0%,\s*4%,\s*1;\s*\/\* #0a0a0a \*\//,
    );
  });

  it('defines readable text and visible borders', () => {
    expect(stylesheet).toMatch(
      /\.theme-ultra-dark\s*\{[\s\S]*--color-text-default:\s*0,\s*0%,\s*91%,\s*1;/,
    );
    expect(stylesheet).toMatch(
      /\.theme-ultra-dark\s*\{[\s\S]*--color-border-default:\s*0,\s*0%,\s*37%,\s*1;/,
    );
  });

  it('meets contrast targets for text and component boundaries', () => {
    const background = grayToken('--color-bg-default');

    expect(
      contrast(grayToken('--color-text-default'), background),
    ).toBeGreaterThanOrEqual(7);
    expect(
      contrast(grayToken('--color-text-secondary'), background),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(grayToken('--color-border-default'), background),
    ).toBeGreaterThanOrEqual(3);
  });
});
