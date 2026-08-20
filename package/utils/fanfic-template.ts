import type { JSONContent } from '@tiptap/react';
import type { TabbedJSONContent } from '../hooks/use-headless-editor';

const text = (
  value: string,
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>,
): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

const paragraph = (content: JSONContent[]): JSONContent => ({
  type: 'paragraph',
  attrs: { textAlign: 'left' },
  content,
});

const heading = (level: number, content: JSONContent[]): JSONContent => ({
  type: 'heading',
  attrs: { textAlign: 'left', level },
  content,
});

const dBlock = (content: JSONContent): JSONContent => ({
  type: 'dBlock',
  content: [content],
});

const strong = (value: string): JSONContent => text(value, [{ type: 'bold' }]);

const emphasis = (value: string): JSONContent =>
  text(value, [{ type: 'italic' }]);

const listItem = (content: JSONContent[]): JSONContent => ({
  type: 'listItem',
  content: [paragraph(content)],
});

const bulletList = (items: JSONContent[][]): JSONContent => ({
  type: 'bulletList',
  attrs: { tight: true },
  content: items.map(listItem),
});

const shipBasis: JSONContent = {
  type: 'doc',
  content: [
    dBlock(
      heading(1, [
        text('Fanfic Planner ⋆⁺₊✧', [
          {
            type: 'textStyle',
            attrs: { fontSize: '36px' },
          },
        ]),
      ]),
    ),
    dBlock({
      type: 'callout',
      content: [
        paragraph([
          text('✨ '),
          strong('Welcome dear writer!'),
          text(
            ' Here is a template with four different tabs to help you organize your WIP. You can navigate them from the left panel on desktop and bottom on mobile/tablet.',
          ),
        ]),
      ],
    }),
    dBlock(paragraph([])),
    dBlock(heading(1, [text('☾ Ship Basis')])),
    dBlock(
      bulletList([
        [strong('Title'), text(':')],
        [strong('Fandom:')],
        [strong('Category'), text(':')],
        [strong('Rating'), text(':')],
        [strong('Tags/tropes'), text(':')],
        [strong('Relationship:')],
        [strong('Characters:')],
        [strong('Length:')],
      ]),
    ),
    dBlock(heading(3, [text('Premise')])),
    dBlock(
      paragraph([emphasis('[The idea that made you open this cute dDoc]')]),
    ),
    dBlock(heading(3, [text('Summary')])),
    dBlock(
      paragraph([emphasis('[A little spicy blurb to hook your readers in]')]),
    ),
  ],
};

const plotAndOutline: JSONContent = {
  type: 'doc',
  content: [
    dBlock(heading(1, [text('★Plot & outline')])),
    dBlock(
      paragraph([
        strong('Brain dump'),
        text(' '),
        emphasis(
          '[All the scenes, lines, and half-baked ideas you have on this ship. Put them down now, connect the dots later]',
        ),
      ]),
    ),
    dBlock(paragraph([strong('The spine')])),
    dBlock(
      bulletList([
        [
          strong('Hook'),
          text(': '),
          emphasis(
            '[what is going to immediately grab your readers’ attention]',
          ),
        ],
        [
          strong('Heart'),
          text(': '),
          emphasis('[what your story is really about]'),
        ],
        [
          strong('Tension'),
          text(': '),
          emphasis('[what is driving the plot forward]'),
        ],
      ]),
    ),
    dBlock(paragraph([strong('The skeleton')])),
    dBlock(
      bulletList([
        [
          strong('Beginning'),
          text(': '),
          emphasis('[the status quo, and the thing that breaks it]'),
        ],
        [
          strong('Middle'),
          text(': '),
          emphasis('[the build, the turn, the low point]'),
        ],
        [
          strong('End'),
          text(': '),
          emphasis('[the climax and last note you leave your readers on]'),
        ],
      ]),
    ),
    dBlock(
      paragraph([
        strong('Scenes in order'),
        text(' '),
        emphasis(
          '[line up your key scenes here to shuffle them until everything flows, cut scenes that don’t move the plot or raise the tension.]',
        ),
      ]),
    ),
    dBlock(
      paragraph([
        strong('Chapter breakdown'),
        text(' '),
        emphasis('(if multichap)'),
      ]),
    ),
    dBlock(
      bulletList([
        [strong('Chapter 1'), text(': '), emphasis('[beat + hook]')],
        [strong('Chapter 2'), text(': '), emphasis('[beat + hook]')],
      ]),
    ),
  ],
};

const characters: JSONContent = {
  type: 'doc',
  content: [
    dBlock(heading(1, [text('𖠋 Characters')])),
    dBlock(paragraph([emphasis('[Copy this block for each character]')])),
    dBlock(
      bulletList([
        [strong('name / role'), text(':')],
        [
          strong('In a nutshell'),
          text(': '),
          emphasis('[who they are in one line]'),
        ],
        [
          strong('Canon vs your take'),
          text(': '),
          emphasis("[what's canon, and where your headcanon takes over]"),
        ],
        [
          strong('Voice'),
          text(': '),
          emphasis('[how they talk, what makes them recognisable]'),
        ],
        [
          strong('Wants vs needs'),
          text(': '),
          emphasis(
            '[what they chase vs what they actually need, the gap is their arc]',
          ),
        ],
        [
          strong('Wound'),
          text(': '),
          emphasis('[the old hurt, and how it affects them]'),
        ],
        [
          strong('Arc'),
          text(': '),
          emphasis("[who they start as, who they've become by the end]"),
        ],
        [
          strong('Details'),
          text(': '),
          emphasis('[Quirks that make them stand out]'),
        ],
      ]),
    ),
  ],
};

const worldAndCanon: JSONContent = {
  type: 'doc',
  content: [
    dBlock(heading(1, [text('꩜ World & Canon')])),
    dBlock(
      paragraph([
        emphasis(
          '[for AUs, canon-divergence, and fix-its. Skip if canon-compliant]',
        ),
      ]),
    ),
    dBlock(
      bulletList([
        [
          strong('Divergence'),
          text(': '),
          emphasis('[the exact point your version splits from canon]'),
        ],
        [
          strong('Ripple'),
          text(': '),
          emphasis('[what changes downstream once that first domino falls]'),
        ],
        [
          strong('Keep vs change'),
          text(': '),
          emphasis(
            "[the canon and the emotional beats you're honouring, and the ones you're rewriting]",
          ),
        ],
        [
          strong('Altered rules'),
          text(': '),
          emphasis(
            "[the elements you're bending, and how you keep them believable]",
          ),
        ],
        [
          strong('Canon to respect'),
          text(': '),
          emphasis(
            '[the names, events, and lore you don’t want to alter, plus the plot holes your changes open up]',
          ),
        ],
        [strong('Setting'), text(': '), emphasis('[time, place, atmosphere]')],
        [
          strong('Details bank'),
          text(': '),
          emphasis(
            '[drop all the world specifics you have in mind to keep track]',
          ),
        ],
      ]),
    ),
  ],
};

export const FANFIC_TEMPLATE: TabbedJSONContent = {
  type: 'tabbed-doc',
  title: 'Fanfic Planner',
  tabs: [
    { name: 'Ship Basis', emoji: '🥐', content: shipBasis },
    { name: 'Plot & Outline', emoji: '🍩', content: plotAndOutline },
    { name: 'Characters', emoji: '🍦', content: characters },
    { name: 'World & Canon', emoji: '🧋', content: worldAndCanon },
  ],
};
