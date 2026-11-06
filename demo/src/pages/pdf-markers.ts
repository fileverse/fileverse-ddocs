// Reads the §Pn§ debug markers back out of a printed PDF's per-page text
// (docs/PAGES_MODE.md §6.1). Plain TS: scripts/pages-print-check.cjs imports
// it with Node's type stripping.
const MARKER = /§\s*P\s*(\d+)\s*§/g;

// `continued`: 1-based pages a box taller than a page carries on onto; no
// element starts there, so they carry no marker.
export function checkMarkers(
  pages: string[],
  expectedPageCount?: number,
  continued: number[] = [],
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  pages.forEach((text, i) => {
    const page = i + 1;
    const found = [...text.matchAll(MARKER)].map((m) => Number(m[1]));
    if (continued.includes(page)) {
      if (found.length) {
        problems.push(
          `page ${page}: found ${found.map((n) => `§P${n}§`).join(', ')} on a continued page`,
        );
      }
    } else if (found.length === 0) {
      problems.push(`page ${page}: no marker (a break the screen did not predict)`);
    } else if (found.length > 1 || found[0] !== page) {
      problems.push(
        `page ${page}: found ${found.map((n) => `§P${n}§`).join(', ')}`,
      );
    }
  });
  if (expectedPageCount !== undefined && pages.length !== expectedPageCount) {
    problems.push(
      `page count: predicted ${expectedPageCount}, printed ${pages.length}`,
    );
  }
  return { ok: problems.length === 0, problems };
}
