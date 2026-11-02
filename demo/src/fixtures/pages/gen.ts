// Deterministic text for the Pages M0 fixtures (docs/PAGES_MODE.md §5).
const WORDS = (
  'the of payment terms agreement party shall within days notice service ' +
  'delivery schedule invoice provide reasonable written consent obligations ' +
  'confidential information project milestone review approval budget scope ' +
  'deliverable acceptance criteria warranty period liability limitation ' +
  'performance quality standard requirement document version change request ' +
  'stakeholder timeline resource allocation estimate contingency risk ' +
  'mitigation governance reporting cadence quarterly annual summary analysis'
).split(' ');

export const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

export const sentence = (rand: () => number, min = 6, max = 22) => {
  const n = min + Math.floor(rand() * (max - min));
  const words = Array.from(
    { length: n },
    () => WORDS[Math.floor(rand() * WORDS.length)],
  );
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return `${words.join(' ')}.`;
};

export const sentences = (rand: () => number, min: number, max: number) =>
  Array.from({ length: min + Math.floor(rand() * (max - min)) }, () =>
    sentence(rand),
  ).join(' ');

export const paragraphs = (
  rand: () => number,
  count: number,
  min = 2,
  max = 9,
) =>
  Array.from({ length: count }, () => `<p>${sentences(rand, min, max)}</p>`).join(
    '',
  );

// Solid SVG of a fixed intrinsic size, as a data URL (no network).
export const svgImage = (width: number, height: number, fill = '#c7d2fe') =>
  `<img src="data:image/svg+xml;base64,${btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/></svg>`,
  )}" width="${width}">`;
