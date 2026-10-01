import { describe, expect, it } from 'vitest';
import { declaredValue, resolveMarkerFont, type Run } from './marker-font';

const run = (
  fontSize: string | null,
  fontFamily: string | null = null,
  onParagraph = false,
): Run => ({
  fontSize: fontSize === null ? null : { value: fontSize, onParagraph },
  fontFamily: fontFamily === null ? null : { value: fontFamily, onParagraph },
});

const font = (runs: Run[], paragraphHasOwnSize = false) =>
  resolveMarkerFont(runs, paragraphHasOwnSize);

describe('declaredValue', () => {
  it("takes the run's own value first", () => {
    expect(declaredValue('12px', '20px')).toEqual({
      value: '12px',
      onParagraph: false,
    });
  });

  it("falls back to the paragraph's, treating '' as unset", () => {
    expect(declaredValue('', '20px')).toEqual({
      value: '20px',
      onParagraph: true,
    });
    expect(declaredValue(null, '  ')).toBeNull();
  });
});

describe('resolveMarkerFont', () => {
  it('takes a value every run agrees on', () => {
    expect(font([run('12px', 'Georgia'), run('12px', 'Georgia')])).toEqual({
      fontSize: '12px',
      fontFamily: '"georgia"',
    });
  });

  it('leaves a property unset when runs disagree or one is unset', () => {
    expect(font([run('12px'), run('24px')]).fontSize).toBeNull();
    expect(font([run('12px'), run(null)]).fontSize).toBeNull();
  });

  it('decides size and family independently', () => {
    expect(font([run('12px', 'Georgia'), run('12px', 'Arial')])).toEqual({
      fontSize: '12px',
      fontFamily: null,
    });
  });

  it('has nothing to say without runs', () => {
    expect(font([])).toEqual({ fontSize: null, fontFamily: null });
  });

  describe('sizes (M-1, M-4)', () => {
    it.each([
      ['12px', '12px'],
      ['12.0px', '12px'],
      [' 12PX ', '12px'],
      ['.50em', '0.5em'],
      ['11pt', '11pt'],
      ['1.2rem', '1.2rem'],
      ['large', 'large'],
      ['150%', '150%'],
      ['larger', 'larger'],
    ])('%s is written as %s', (raw, expected) => {
      expect(font([run(raw)]).fontSize).toBe(expected);
    });

    it('treats 12.0px and 12px as one size', () => {
      expect(font([run('12.0px'), run('12px')]).fontSize).toBe('12px');
    });

    it('keeps units apart: 12px next to 9pt is mixed', () => {
      expect(font([run('12px'), run('9pt')]).fontSize).toBeNull();
    });

    it.each(['2ex', '3ch', 'calc(1em + 2px)', 'var(--x)', 'inherit', 'bogus'])(
      '%s cannot be reproduced on the marker',
      (raw) => {
        expect(font([run(raw)]).fontSize).toBeNull();
      },
    );

    it('copies a relative size the paragraph declared', () => {
      expect(font([run('150%', null, true)], true).fontSize).toBe('150%');
    });

    it("copies a run's relative size when the paragraph has no size", () => {
      expect(font([run('150%')]).fontSize).toBe('150%');
      expect(font([run('1.5em')]).fontSize).toBe('1.5em');
    });

    it("drops a run's relative size over a paragraph with its own size", () => {
      expect(font([run('150%')], true).fontSize).toBeNull();
      expect(font([run('1.5em')], true).fontSize).toBeNull();
      expect(font([run('larger')], true).fontSize).toBeNull();
    });

    it("keeps a run's absolute size over a paragraph with its own size", () => {
      expect(font([run('12px')], true).fontSize).toBe('12px');
    });
  });

  describe('families (M-4)', () => {
    it.each([
      ['Comic Sans MS', '"comic sans ms"'],
      ['"Comic Sans MS"', '"comic sans ms"'],
      ["'comic  sans MS'", '"comic sans ms"'],
      ['Georgia, serif', '"georgia", serif'],
      ['Arial,sans-serif', '"arial", sans-serif'],
      ['"Georgia", "serif"', '"georgia", "serif"'],
    ])('%s is written as %s', (raw, expected) => {
      expect(font([run(null, raw)]).fontFamily).toBe(expected);
    });

    it('treats quoted and unquoted spellings of a name as one family', () => {
      expect(
        font([run(null, 'Comic Sans MS'), run(null, '"Comic Sans MS"')])
          .fontFamily,
      ).toBe('"comic sans ms"');
    });

    it('keeps a quoted "serif" apart from the generic serif', () => {
      expect(
        font([run(null, '"serif"'), run(null, 'serif')]).fontFamily,
      ).toBeNull();
    });

    it.each([
      'inherit',
      'initial',
      'unset',
      'revert',
      'revert-layer',
      'var(--f)',
      '"open',
    ])('%s cannot be reproduced on the marker', (raw) => {
      expect(font([run(null, raw)]).fontFamily).toBeNull();
    });

    it('escapes quotes when writing a name back', () => {
      expect(font([run(null, `'a"b'`)]).fontFamily).toBe('"a\\"b"');
    });
  });

  it('ignores values that would end the inline declaration', () => {
    expect(font([run('12px; color: red')]).fontSize).toBeNull();
    expect(font([run('12px}')]).fontSize).toBeNull();
    expect(font([run(null, 'Georgia; background: red')]).fontFamily).toBeNull();
  });
});
