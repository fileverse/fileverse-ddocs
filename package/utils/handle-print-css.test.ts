import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Authored spacing reaches the print document as an inline `margin-top` or
// `margin-bottom`. Inline wins on specificity, but only for the longhand it
// actually sets — so a `margin:` shorthand in the print stylesheet keeps
// overriding whichever side the author left unset, and a paragraph with only
// `spaceBefore` still gets the stylesheet's bottom margin. These selectors are
// the ones ParagraphSpacing can target (paragraph, heading, listItem) plus the
// list containers that wrap them.
const source = readFileSync(path.join(__dirname, 'handle-print.ts'), 'utf8');

const SHORTHAND_ON_SPACING_BLOCK =
  /\.print-content-root\s+(?:p|h[1-6]|li|ul|ol)\b[^{]*\{[^}]*\bmargin:\s/g;

describe('print stylesheet', () => {
  it('never uses the margin shorthand on a block that can carry spacing', () => {
    const offenders = source.match(SHORTHAND_ON_SPACING_BLOCK) ?? [];

    expect(offenders).toEqual([]);
  });

  it('still sets the default rhythm, via longhands', () => {
    expect(source).toMatch(/\.print-content-root p \{[^}]*margin-bottom:/);
    expect(source).toMatch(/\.print-content-root h1 \{[^}]*margin-top:/);
    expect(source).toMatch(/\.print-content-root li \{[^}]*margin-top:/);
  });
});
