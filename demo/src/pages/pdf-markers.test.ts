import { checkMarkers } from './pdf-markers';

describe('checkMarkers', () => {
  it('accepts one matching marker per page', () => {
    expect(checkMarkers(['§P1§ text', 'more §P2§', '§P3§'], 3)).toEqual({
      ok: true,
      problems: [],
    });
  });

  it('flags a page the browser added (no marker)', () => {
    const result = checkMarkers(['§P1§', 'overflow', '§P2§'], 2);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/page 2/);
  });

  it('flags a marker on the wrong page', () => {
    const result = checkMarkers(['§P1§', '§P3§']);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/page 2.*§P3§/);
  });

  it('flags a page count different from the prediction', () => {
    expect(checkMarkers(['§P1§', '§P2§'], 3).ok).toBe(false);
  });

  it('reads a marker split by the PDF text layer', () => {
    expect(checkMarkers(['§P 1 §', '§ P2§'], 2).ok).toBe(true);
  });
});
