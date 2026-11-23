import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Editor, EditorContent, type JSONContent } from '@tiptap/react';
import { AllSelection, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { unwrapDBlocksInJSON } from '../utils/block-schema';
import { EditingProvider } from '../hooks/use-editing-context';
import { AIWriter } from './ai-writer';
import { destroyTracked, makeEditor, track } from './caret-marks/test-helpers';
import { flatShape } from './list-toggle/test-helpers';

// Probes for TIPTAP_UPGRADE.md §5.7. 3.11 passes `selected` to a React node
// view whenever the selection COVERS the node (from <= pos, to >= pos + size);
// 3.31 narrows it to ProseMirror node selections. The views read it as:
//   resizable-media: border colour + the four corner handles (images only)
//   table cell:      the options trigger shows when hovered || selected
//   ai-writer:       does not read it; only ProseMirror-selectednode is left
// Each snapshot is that chrome, not the whole DOM.

const p = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const cell = (text: string) => ({ type: 'tableCell', content: [p(text)] });
const v1Doc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'dBlock', content: [p('before')] },
    {
      type: 'dBlock',
      content: [
        {
          type: 'resizableMedia',
          attrs: { src: 'https://example.com/a.png', 'media-type': 'img' },
        },
      ],
    },
    { type: 'dBlock', content: [p('between')] },
    {
      type: 'dBlock',
      content: [{ type: 'aiWriter', attrs: { prompt: '', content: '' } }],
    },
    {
      type: 'dBlock',
      content: [
        {
          type: 'table',
          content: [{ type: 'tableRow', content: [cell('c1'), cell('c2')] }],
        },
      ],
    },
    { type: 'dBlock', content: [p('after')] },
  ],
};

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const nodePos = (editor: Editor, typeName: string, nth = 0) => {
  let found = -1;
  let seen = 0;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === typeName && seen++ === nth) {
      found = pos;
    }
  });
  if (found === -1) throw new Error(`no ${typeName}`);
  return found;
};
const textPos = (editor: Editor, text: string, offset = 0) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) {
      found = pos + offset;
    }
  });
  if (found === -1) throw new Error(`no text ${text}`);
  return found;
};

type Harness = { editor: Editor; container: HTMLElement };
let current: Harness | null = null;

const mount = async (version: number): Promise<Harness> => {
  const editor = new Editor({
    extensions: [
      ...getHeadlessExtensions({ schemaVersion: version }),
      AIWriter,
    ],
    textDirection: 'auto',
  });
  editor.commands.setContent(
    version === 1 ? v1Doc : unwrapDBlocksInJSON(v1Doc),
  );
  const { container } = render(
    <EditingProvider isPreviewMode={false} isSuggestionMode={false}>
      <EditorContent editor={editor} />
    </EditingProvider>,
  );
  await waitFor(() => {
    expect(container.querySelector('.node-resizableMedia')).toBeTruthy();
    expect(container.querySelector('.node-aiWriter')).toBeTruthy();
    expect(container.querySelectorAll('td').length).toBe(2);
  });
  await flush();
  current = { editor, container };
  return current;
};

afterEach(() => {
  destroyTracked();
  cleanup();
  current?.editor.destroy();
  current = null;
});

const select = async (
  editor: Editor,
  make: (
    editor: Editor,
  ) => NodeSelection | TextSelection | AllSelection | CellSelection,
) => {
  await act(async () => {
    editor.view.dispatch(editor.state.tr.setSelection(make(editor)));
  });
  await flush();
};

const mediaChrome = (container: HTMLElement) => {
  const root = container.querySelector('.node-resizableMedia')!;
  const box = root.querySelector('div.border-2')!;
  return {
    border: box.className.includes('border-[#5c0aff]')
      ? 'selected'
      : box.className.includes('border-transparent')
        ? 'transparent'
        : 'other',
    corners: root.querySelectorAll('.corner-resize-handle').length,
    selectednode: root.classList.contains('ProseMirror-selectednode'),
  };
};
const aiWriterChrome = (container: HTMLElement) => ({
  selectednode: container
    .querySelector('.node-aiWriter')!
    .classList.contains('ProseMirror-selectednode'),
});
const cellChrome = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('td')).map((td) => ({
    trigger: td.querySelectorAll('.trigger-button').length,
    selectedCell: td.classList.contains('selectedCell'),
    selectednode: !!td.querySelector('.ProseMirror-selectednode'),
  }));

const SELECTIONS: Record<
  string,
  (
    editor: Editor,
  ) => NodeSelection | TextSelection | AllSelection | CellSelection
> = {
  'caret in a paragraph': (e) =>
    TextSelection.create(e.state.doc, textPos(e, 'before', 2)),
  'NodeSelection on the media': (e) =>
    NodeSelection.create(e.state.doc, nodePos(e, 'resizableMedia')),
  'NodeSelection on the ai-writer': (e) =>
    NodeSelection.create(e.state.doc, nodePos(e, 'aiWriter')),
  'select all': (e) => new AllSelection(e.state.doc),
  'TextSelection across the media': (e) =>
    TextSelection.create(
      e.state.doc,
      textPos(e, 'before', 2),
      textPos(e, 'between', 3),
    ),
  'TextSelection across the ai-writer': (e) =>
    TextSelection.create(
      e.state.doc,
      textPos(e, 'between', 3),
      textPos(e, 'c1', 1),
    ),
  'TextSelection inside one cell': (e) =>
    TextSelection.create(e.state.doc, textPos(e, 'c1', 0), textPos(e, 'c1', 2)),
  'TextSelection across both cells': (e) =>
    TextSelection.create(e.state.doc, textPos(e, 'c1', 1), textPos(e, 'c2', 1)),
  'TextSelection across the whole table': (e) =>
    TextSelection.create(
      e.state.doc,
      textPos(e, 'between', 3),
      textPos(e, 'after', 2),
    ),
  'CellSelection over two cells': (e) =>
    CellSelection.create(
      e.state.doc,
      nodePos(e, 'tableCell', 0),
      nodePos(e, 'tableCell', 1),
    ),
  'CellSelection over the first cell': (e) =>
    CellSelection.create(e.state.doc, nodePos(e, 'tableCell', 0)),
};

const defineSuite = (version: number) => {
  describe(`schema v${version}`, () => {
    it.each(Object.keys(SELECTIONS))('%s', async (name) => {
      const { editor, container } = await mount(version);
      await select(editor, SELECTIONS[name]);
      expect({
        selection: editor.state.selection.toJSON().type,
        media: mediaChrome(container),
        aiWriter: aiWriterChrome(container),
        cells: cellChrome(container),
      }).toMatchSnapshot();
    });
  });
};

describe('React node view selected chrome (§5.7)', () => {
  defineSuite(1);
  defineSuite(2);
});

// §5.18: TaskItem's node view (3.15.2 changed attribute updates and
// contentElement parsing). The checkbox state is read from the rendered DOM,
// the document from the outline, and the HTML from getHTML with block ids masked.
const TASKS =
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>a</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>b</p></div></li></ul></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>c</p></div></li></ul><p>tail</p>';

const maskIds = (html: string) =>
  html.replace(/data-block-id="[^"]*"/g, 'data-block-id="<id>"');

const taskDom = (editor: Editor) =>
  Array.from(editor.view.dom.querySelectorAll('li.task-item')).map((li) => ({
    text: li.querySelector('p')?.textContent,
    dataChecked: li.getAttribute('data-checked'),
    checkbox: (li.querySelector('input[type="checkbox"]') as HTMLInputElement)
      .checked,
  }));

const defineTaskSuite = (version: number) => {
  describe(`schema v${version}`, () => {
    it('toggling a task item and a nested one', () => {
      const editor = track(makeEditor(version, TASKS));
      const boxes = () =>
        Array.from(
          editor.view.dom.querySelectorAll<HTMLInputElement>(
            'li.task-item input[type="checkbox"]',
          ),
        );
      const steps: { dom: ReturnType<typeof taskDom>; shape: string }[] = [];
      const record = () =>
        steps.push({ dom: taskDom(editor), shape: flatShape(editor) });

      record();
      boxes()[0].click();
      record();
      boxes()[1].click();
      record();
      boxes()[0].click();
      record();
      expect(steps).toMatchSnapshot();
    });

    it('nested task items HTML and its round-trip', () => {
      const editor = track(makeEditor(version, TASKS));
      const html = maskIds(editor.getHTML());
      const again = track(makeEditor(version, editor.getHTML()));
      expect(html).toMatchSnapshot();
      expect(maskIds(again.getHTML())).toBe(html);
      expect(flatShape(again)).toBe(flatShape(editor));
      expect(taskDom(again)).toEqual(taskDom(editor));
    });
  });
};

describe('TaskItem node view (§5.18)', () => {
  defineTaskSuite(1);
  defineTaskSuite(2);
});
