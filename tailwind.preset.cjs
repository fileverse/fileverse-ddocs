// This file is the `@fileverse-dev/ddoc/tailwind` preset. It composes the ui preset
// (dark mode, theme, design-system classes) and adds the `mobile` screen.
// It also adds the ddoc-* variants (docs/DROP_IN_EDITOR.md §2.9).
// Consumers: `presets: [require('@fileverse-dev/ddoc/tailwind')]` and add
// node_modules/@fileverse-dev/ddoc/dist/**/*.{js,mjs} plus
// node_modules/@fileverse/ui/dist/**/*.{js,mjs} to `content` (the dist is chunked).
const plugin = require('tailwindcss/plugin');

// Same widths as the screens, evaluated against the editor root when the
// element is inside one and against the window otherwise. :where() keeps the
// window form at the specificity of a screen variant.
const DDOC_BREAKPOINTS = { sm: 640, md: 768, mobile: 960, lg: 1024, xl: 1280 };

module.exports = {
  presets: [require('@fileverse/ui/tailwind')],
  theme: {
    extend: {
      screens: {
        mobile: '960px',
      },
    },
  },
  plugins: [
    plugin(({ addVariant, matchVariant }) => {
      const breakpoints = Object.entries(DDOC_BREAKPOINTS);
      // Registration order is CSS order. Like Tailwind's screens: max variants
      // first, widest first, so the narrower one wins; then min, ascending.
      for (const [name, px] of [...breakpoints].reverse()) {
        addVariant(`ddoc-max-${name}`, [
          `@container ddoc-editor (max-width: ${px - 0.02}px)`,
          `@media (max-width: ${px - 0.02}px) { &:where(:not(.ddoc-editor-cq *)) }`,
        ]);
      }
      for (const [name, px] of breakpoints) {
        addVariant(`ddoc-${name}`, [
          `@container ddoc-editor (min-width: ${px}px)`,
          `@media (min-width: ${px}px) { &:where(:not(.ddoc-editor-cq *)) }`,
        ]);
      }
      // One-off widths: ddoc-min-[1410px]: and ddoc-max-[1280px]: (inclusive).
      for (const bound of ['min', 'max']) {
        matchVariant(
          `ddoc-${bound}`,
          (value) => [
            `@container ddoc-editor (${bound}-width: ${value})`,
            `@media (${bound}-width: ${value}) { &:where(:not(.ddoc-editor-cq *)) }`,
          ],
          {
            sort: (a, z) =>
              (parseFloat(a.value) - parseFloat(z.value)) *
              (bound === 'min' ? 1 : -1),
          },
        );
      }
    }),
  ],
};
