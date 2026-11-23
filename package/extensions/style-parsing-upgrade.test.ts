import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import { makeEditor, destroyTracked, track } from './caret-marks/test-helpers';
import { isBlackOrWhiteShade } from '../utils/color-utils';

// Probe for TIPTAP_UPGRADE.md §5.6: Color, FontFamily, Highlight, FontSize and
// LineHeight store the authored value instead of the browser-normalised one.
// It pins 3.11 (the stored attribute strings and the rendered HTML); a bump that
// changes one is decided in the spec, never by `vitest -u`.

afterEach(destroyTracked);

const mount = (schemaVersion: number, html: string) =>
  track(makeEditor(schemaVersion, html));

/** Every text run with the non-null attributes of each mark it carries. */
const stored = (editor: Editor) => {
  const out: { text: string; marks: Record<string, unknown> }[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const marks: Record<string, unknown> = {};
    node.marks.forEach((mark) => {
      marks[mark.type.name] = Object.fromEntries(
        Object.entries(mark.attrs).filter(([, v]) => v !== null),
      );
    });
    out.push({ text: node.text!, marks });
  });
  return out;
};

/** Paragraph (and nothing around it), so v1's dBlock chrome stays out. */
const paragraphHtml = (editor: Editor) =>
  editor.view.dom
    .querySelector('p')
    ?.outerHTML.replace(/ data-block-id="[^"]*"/, '');

/** Non-null attributes of the first textblock, minus the random block id. */
const blockAttrs = (editor: Editor) => {
  let attrs: Record<string, unknown> = {};
  editor.state.doc.descendants((node) => {
    if (!node.isTextblock) return true;
    attrs = Object.fromEntries(
      Object.entries(node.attrs).filter(
        ([k, v]) => v !== null && k !== 'blockId',
      ),
    );
    return false;
  });
  return attrs;
};

const span = (style: string, text = 'sample') =>
  `<p><span style='${style}'>${text}</span></p>`;

const CASES = {
  'color #333': span('color: #333'),
  'color #1f2328': span('color: #1f2328'),
  'color rgb(51,51,51)': span('color: rgb(51,51,51)'),
  'color rgb(51, 51, 51)': span('color: rgb(51, 51, 51)'),
  'font-family quoted multi-word': span('font-family: "Open Sans", sans-serif'),
  'font-family unquoted': span('font-family: Georgia, serif'),
  'background-color highlight (span)': span('background-color: #ffff00'),
  'background-color highlight (mark)':
    '<p><mark style="background-color: #ffff00" data-color="#ffff00">sample</mark></p>',
  'font-size 14px': span('font-size: 14px'),
  'line-height 1.5 (span)': span('line-height: 1.5'),
  'line-height 1.5 (paragraph)':
    '<p style="line-height: 1.5"><span>sample</span></p>',
  'all combined': span(
    'color: #1f2328; font-family: "Open Sans", sans-serif; background-color: #ffff00; font-size: 14px; line-height: 1.5',
  ),
} as const;

describe.each([1, 2])('style string parsing, §5.6 (schema v%i)', (version) => {
  it.each(Object.entries(CASES))('%s', (_name, html) => {
    const editor = mount(version, html);
    expect({
      stored: stored(editor),
      block: blockAttrs(editor),
      html: paragraphHtml(editor),
    }).toMatchSnapshot();
  });
});

// The paste clean-up (use-tab-editor.tsx) keeps a pasted colour only when
// isBlackOrWhiteShade is false for it. It lives inline in an effect, so this
// reads the strings the editor stores for each fixture and asks the same helper.
describe('paste colour clean-up input, §5.6', () => {
  const COLOUR_CASES = [
    'color: #333',
    'color: #333333',
    'color: #1f2328',
    'color: #000000',
    'color: #ffffff',
    'color: #f3f3f3',
    'color: rgb(51,51,51)',
    'color: rgb(51, 51, 51)',
    'color: rgb(20, 20, 20)',
    'color: rgb(250, 250, 250)',
    'color: rgb(31, 35, 40)',
    'color: #ff0000',
  ];

  it.each(COLOUR_CASES)('%s', (style) => {
    const editor = mount(1, span(style));
    const color = stored(editor)[0].marks.textStyle as { color?: string };
    expect({
      storedColor: color?.color ?? null,
      cleanUp: color?.color
        ? isBlackOrWhiteShade(color.color)
          ? 'stripped'
          : 'kept'
        : 'no colour stored',
    }).toMatchSnapshot();
  });
});

// 3.34 stores a pasted hex colour as authored, where a browser on 3.11 stored
// its rgb() form; the clean-up must treat each hex grey as it treated that form
// (Task 13, Keep: isBlackOrWhiteShade normalises hex greys).
describe('paste colour clean-up of hex greys, §5.6', () => {
  const HEX_GREYS = [
    ['#141414', 'rgb(20, 20, 20)', 'stripped'],
    ['#808080', 'rgb(128, 128, 128)', 'stripped'],
    ['#fafafa', 'rgb(250, 250, 250)', 'stripped'],
    ['#333', 'rgb(51, 51, 51)', 'kept'],
    ['#fff', 'rgb(255, 255, 255)', 'stripped'],
    ['#808080ff', 'rgb(128, 128, 128)', 'stripped'],
    ['#80808080', 'rgba(128, 128, 128, 0.5)', 'kept'],
  ] as const;

  it.each(HEX_GREYS)('%s cleans up as %s', (hex, rgb, expected) => {
    const editor = mount(1, span(`color: ${hex}`));
    const color = (stored(editor)[0].marks.textStyle as { color: string })
      .color;
    const cleanUp = (c: string) =>
      isBlackOrWhiteShade(c) ? 'stripped' : 'kept';
    expect(color).toBe(hex);
    expect(cleanUp(color)).toBe(cleanUp(rgb));
    expect(cleanUp(color)).toBe(expected);
  });
});
