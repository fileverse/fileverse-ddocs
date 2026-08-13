import Italic from '@tiptap/extension-italic';
import Bold from '@tiptap/extension-bold';
import { markInputRule, markPasteRule } from '@tiptap/core';

// CommonMark forbids whitespace adjacent to emphasis delimiters — `* x *` is
// multiplication, not italics. Upstream tiptap's regexes accept the spaced
// form, which ate `5 * 3 * 2` while typing/pasting (TEC-2634). markdown-it on
// import already follows CommonMark, so these rules also make typing agree
// with import. Content stays the LAST capture group: markInputRule reads
// match[match.length - 1].
const content = (delim: string) =>
  `([^${delim}\\s](?:[^${delim}]*[^${delim}\\s])?)`;

export const italicStarInputRegex = new RegExp(
  `(?:^|\\s)(\\*(?!\\s+\\*)${content('*')}\\*(?!\\s+\\*))$`,
);
export const italicStarPasteRegex = new RegExp(
  `(?:^|\\s)(\\*(?!\\s+\\*)${content('*')}\\*(?!\\s+\\*))`,
  'g',
);
export const italicUnderscoreInputRegex = new RegExp(
  `(?:^|\\s)(_(?!\\s+_)${content('_')}_(?!\\s+_))$`,
);
export const italicUnderscorePasteRegex = new RegExp(
  `(?:^|\\s)(_(?!\\s+_)${content('_')}_(?!\\s+_))`,
  'g',
);
export const boldStarInputRegex = new RegExp(
  `(?:^|\\s)(\\*\\*(?!\\s+\\*\\*)${content('*')}\\*\\*(?!\\s+\\*\\*))$`,
);
export const boldStarPasteRegex = new RegExp(
  `(?:^|\\s)(\\*\\*(?!\\s+\\*\\*)${content('*')}\\*\\*(?!\\s+\\*\\*))`,
  'g',
);
export const boldUnderscoreInputRegex = new RegExp(
  `(?:^|\\s)(__(?!\\s+__)${content('_')}__(?!\\s+__))$`,
);
export const boldUnderscorePasteRegex = new RegExp(
  `(?:^|\\s)(__(?!\\s+__)${content('_')}__(?!\\s+__))`,
  'g',
);

export const CommonMarkItalic = Italic.extend({
  addInputRules() {
    return [
      markInputRule({ find: italicStarInputRegex, type: this.type }),
      markInputRule({ find: italicUnderscoreInputRegex, type: this.type }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({ find: italicStarPasteRegex, type: this.type }),
      markPasteRule({ find: italicUnderscorePasteRegex, type: this.type }),
    ];
  },
});

export const CommonMarkBold = Bold.extend({
  addInputRules() {
    return [
      markInputRule({ find: boldStarInputRegex, type: this.type }),
      markInputRule({ find: boldUnderscoreInputRegex, type: this.type }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({ find: boldStarPasteRegex, type: this.type }),
      markPasteRule({ find: boldUnderscorePasteRegex, type: this.type }),
    ];
  },
});
