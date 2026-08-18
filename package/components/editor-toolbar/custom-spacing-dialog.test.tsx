import { describe, it, expect, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from '@testing-library/react';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LineHeight } from '../../extensions/line-height';
import { ParagraphSpacing } from '../../extensions/paragraph-spacing';
import {
  CustomSpacingDialog,
  CustomSpacingDialogHost,
} from './custom-spacing-dialog';
import {
  openCustomSpacingDialog,
  useCustomSpacingStore,
} from '../../stores/custom-spacing-store';

const makeEditor = (content: string) =>
  new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      LineHeight,
      ParagraphSpacing,
    ] as AnyExtension[],
    content,
  });

const spaceBefores = (editor: Editor) => {
  const values: unknown[] = [];
  editor.state.doc.forEach((node) => values.push(node.attrs.spaceBefore));
  return values;
};

const spaceAfters = (editor: Editor) => {
  const values: unknown[] = [];
  editor.state.doc.forEach((node) => values.push(node.attrs.spaceAfter));
  return values;
};

// Queried by label, not position — the dialog's layout order is a design
// decision and should be free to change without touching these tests.
const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;

describe('CustomSpacingDialog', () => {
  const editors: Editor[] = [];
  const track = (editor: Editor) => {
    editors.push(editor);
    return editor;
  };

  afterEach(() => {
    cleanup();
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('leaves a mixed field blank rather than showing one block’s value', () => {
    const editor = track(
      makeEditor(
        '<p style="margin-top: 12pt">one</p>' +
          '<p style="margin-top: 4pt">two</p>',
      ),
    );
    editor.commands.selectAll();

    render(
      <CustomSpacingDialog editor={editor} open onOpenChange={() => {}} />,
    );

    const before = field('Before');
    expect(before.value).toBe('');
    expect(before.placeholder).toBe('Mixed');
  });

  // The trap this guards: hitting Apply after editing one field must not
  // flatten the others onto whatever the first block happened to have.
  it('does not stamp an untouched mixed field onto the selection', () => {
    const editor = track(
      makeEditor(
        '<p style="margin-top: 12pt">one</p>' +
          '<p style="margin-top: 4pt">two</p>',
      ),
    );
    editor.commands.selectAll();

    render(
      <CustomSpacingDialog editor={editor} open onOpenChange={() => {}} />,
    );

    fireEvent.change(field('After'), { target: { value: '6' } });
    fireEvent.click(screen.getByText('Apply'));

    expect(spaceAfters(editor)).toEqual([6, 6]);
    expect(spaceBefores(editor)).toEqual([12, 4]);
  });

  it('writes an emptied field as unset and 0 as an explicit zero', () => {
    const editor = track(
      makeEditor('<p style="margin-top: 12pt; margin-bottom: 8pt">one</p>'),
    );
    editor.commands.setTextSelection(2);

    render(
      <CustomSpacingDialog editor={editor} open onOpenChange={() => {}} />,
    );

    fireEvent.change(field('Before'), { target: { value: '' } });
    fireEvent.change(field('After'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Apply'));

    expect(spaceBefores(editor)).toEqual([null]);
    expect(spaceAfters(editor)).toEqual([0]);
  });
});

// The dialog is mounted once, by ddoc-editor; the toolbar dropdown, the
// bubble menu and the app's own menu all reach it through the store.
describe('CustomSpacingDialogHost', () => {
  const editors: Editor[] = [];

  afterEach(() => {
    cleanup();
    useCustomSpacingStore.setState({ isCustomSpacingOpen: false });
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('opens exactly one dialog when an entry point sets the store flag', () => {
    const editor = makeEditor('<p>one</p>');
    editors.push(editor);

    render(<CustomSpacingDialogHost editor={editor} />);
    expect(screen.queryByText('Custom spacing')).toBeNull();

    act(() => openCustomSpacingDialog());
    expect(screen.getAllByText('Custom spacing')).toHaveLength(1);
  });

  it('clearing the store flag closes it', () => {
    const editor = makeEditor('<p>one</p>');
    editors.push(editor);

    render(<CustomSpacingDialogHost editor={editor} />);
    act(() => openCustomSpacingDialog());
    act(() => useCustomSpacingStore.getState().setCustomSpacingOpen(false));
    expect(screen.queryByText('Custom spacing')).toBeNull();
  });
});

// Reported: paste from Google Docs with formatting, change space before/after
// on a paragraph, and the line height collapses to 1%. Google Docs writes a
// unitless `line-height:1.38`, which the percentage converters mangled on the
// round trip that Apply performs on every field.
describe('pasted Google Docs content', () => {
  const GOOGLE_DOCS_PARAGRAPH =
    '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:14pt;">' +
    '<span>text</span></p>';

  const editors: Editor[] = [];
  afterEach(() => {
    cleanup();
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('does not disturb line height when only spacing is changed', () => {
    const editor = makeEditor(GOOGLE_DOCS_PARAGRAPH);
    editors.push(editor);
    editor.commands.setTextSelection(2);
    const before = editor.state.doc.firstChild?.attrs.lineHeight;

    render(
      <CustomSpacingDialog editor={editor} open onOpenChange={() => {}} />,
    );
    fireEvent.change(field('After'), { target: { value: '18' } });
    fireEvent.click(screen.getByText('Apply'));

    expect(editor.state.doc.firstChild?.attrs.spaceAfter).toBe(18);
    expect(editor.state.doc.firstChild?.attrs.lineHeight).toBe(before);
  });
});

// Q1(b): the fields show the spacing the paragraph actually renders with,
// including what the stylesheet supplies, rather than sitting blank while the
// paragraph visibly has a gap.
describe('default spacing in the dialog', () => {
  const mounted: { editor: Editor; style: HTMLStyleElement }[] = [];

  afterEach(() => {
    cleanup();
    mounted.splice(0).forEach(({ editor, style }) => {
      editor.destroy();
      style.remove();
    });
  });

  const mountEditor = (content: string) => {
    const style = document.createElement('style');
    style.textContent =
      '.ProseMirror > * + * { margin-top: 24px; margin-bottom: 10px; }';
    document.head.appendChild(style);
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ trailingNode: false }),
        LineHeight,
        ParagraphSpacing,
      ] as AnyExtension[],
      content,
    });
    mounted.push({ editor, style });
    return editor;
  };

  it('prefills the stylesheet value for a paragraph with nothing set', () => {
    const editor = mountEditor('<p>one</p><p>two</p>');
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 2);

    render(
      <CustomSpacingDialog editor={editor} open onOpenChange={() => {}} />,
    );

    expect(field('Before').value).toBe('18');
    expect(field('After').value).toBe('8');
  });

  // Clearing a field is still how a paragraph is handed back to the
  // stylesheet — otherwise Q1(b) would make pinning irreversible.
  it('still writes null when a prefilled field is cleared', () => {
    const editor = mountEditor('<p>one</p><p>two</p>');
    const second = editor.state.doc.child(0).nodeSize + 2;
    editor.commands.setTextSelection(second);

    render(
      <CustomSpacingDialog editor={editor} open onOpenChange={() => {}} />,
    );
    fireEvent.change(field('Before'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Apply'));

    expect(editor.state.doc.child(1).attrs.spaceBefore).toBeNull();
  });
});
