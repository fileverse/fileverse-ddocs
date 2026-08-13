// Icons for the read-only-preview heading chrome. Shared so the v1 dBlock
// node view and the flat-schema decoration widget cannot drift apart.
const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

// lucide chevron-down; rotated -90deg via CSS when collapsed (= ChevronRight,
// matching the editing cluster's CollapseButton semantics)
export const CHEVRON_SVG = `<svg ${SVG_ATTRS}><path d="m6 9 6 6 6-6"/></svg>`;

// lucide link
export const LINK_SVG = `<svg ${SVG_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
