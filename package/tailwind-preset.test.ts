import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

const build = async (classes: string) => {
  const result = await postcss([
    tailwindcss({
      presets: [require('../tailwind.preset.cjs')],
      content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }],
      corePlugins: { preflight: false },
    }),
  ]).process('@tailwind utilities;', { from: undefined });
  return result.css.replace(/\s+/g, ' ');
};

describe('ddoc tailwind preset', () => {
  it('emits a container rule and a window fallback for min variants', async () => {
    const css = await build('ddoc-mobile:flex');
    expect(css).toContain('@container ddoc-editor (min-width: 960px)');
    expect(css).toContain('@media (min-width: 960px)');
    expect(css).toContain(':not(.ddoc-editor-cq *)');
  });

  it('emits max variants just below the breakpoint', async () => {
    const css = await build('ddoc-max-xl:hidden');
    expect(css).toContain('@container ddoc-editor (max-width: 1279.98px)');
    expect(css).toContain('@media (max-width: 1279.98px)');
  });

  it('takes one-off widths, inclusive like min-[..] and max-[..]', async () => {
    const css = await build('ddoc-max-[1280px]:flex ddoc-min-[1410px]:flex');
    expect(css).toContain('@container ddoc-editor (max-width: 1280px)');
    expect(css).toContain('@media (max-width: 1280px)');
    expect(css).toContain('@container ddoc-editor (min-width: 1410px)');
  });

  it('adds no specificity in the window form', async () => {
    const css = await build('ddoc-md:flex');
    expect(css).toContain('.ddoc-md\\:flex:where(:not(.ddoc-editor-cq *))');
  });

  it('orders max variants so the narrower one wins', async () => {
    const css = await build(
      'ddoc-max-sm:flex ddoc-max-lg:hidden ddoc-md:block',
    );
    const lg = css.indexOf('@container ddoc-editor (max-width: 1023.98px)');
    const sm = css.indexOf('@container ddoc-editor (max-width: 639.98px)');
    const md = css.indexOf('@container ddoc-editor (min-width: 768px)');
    expect(lg).toBeGreaterThan(-1);
    expect(sm).toBeGreaterThan(lg);
    expect(md).toBeGreaterThan(sm);
  });

  it('keeps the mobile screen for viewport-level code', async () => {
    const css = await build('mobile:flex');
    expect(css).toContain('@media (min-width: 960px)');
    expect(css).not.toContain('@container');
  });
});
