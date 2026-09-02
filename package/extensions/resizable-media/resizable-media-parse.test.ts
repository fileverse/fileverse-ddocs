import { describe, it, expect } from 'vitest';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Link from '@tiptap/extension-link';
import { ResizableMedia } from './resizable-media';
import { MediaCaption } from './media-caption';
import { Editor } from '@tiptap/core';

describe('ResizableMedia parseHTML tag: img', () => {
  it('parses data-align from bare img element', () => {
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Link,
        ResizableMedia,
        MediaCaption,
      ],
      content: '<img src="https://example.com/pic.png" data-align="right" />',
    });

    const mediaNode = editor.state.doc.firstChild;
    expect(mediaNode?.type.name).toBe('resizableMedia');
    expect(mediaNode?.attrs.dataAlign).toBe('right');
    editor.destroy();
  });

  it('parses dataalign attribute from bare img element', () => {
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Link,
        ResizableMedia,
        MediaCaption,
      ],
      content: '<img src="https://example.com/pic.png" dataalign="left" />',
    });

    const mediaNode = editor.state.doc.firstChild;
    expect(mediaNode?.type.name).toBe('resizableMedia');
    expect(mediaNode?.attrs.dataAlign).toBe('left');
    editor.destroy();
  });

  it('defaults to center alignment when no data-align attribute is present', () => {
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Link,
        ResizableMedia,
        MediaCaption,
      ],
      content: '<img src="https://example.com/pic.png" />',
    });

    const mediaNode = editor.state.doc.firstChild;
    expect(mediaNode?.type.name).toBe('resizableMedia');
    expect(mediaNode?.attrs.dataAlign).toBe('center');
    editor.destroy();
  });
});
