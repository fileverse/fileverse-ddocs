import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { turndownService, setMarkdownInlineStyles } from './index';
import { Columns, Column } from '../multi-column';
import { DBlock } from '../d-block';
import { Document } from '../document/document';
import { PageBreak } from '../page-break';

const exportStyled = (html: string) => {
  setMarkdownInlineStyles(true);
  try {
    return turndownService.turndown(html);
  } finally {
    setMarkdownInlineStyles(false);
  }
};

// Editor getHTML shape: columns carries layout as a `layout-*` class, each
// column is a div with data-position, content sits in d-block wrappers.
const columnsHtml =
  '<div data-type="columns" class="layout-align-center">' +
  '<div data-type="column" data-position="left">' +
  '<div data-type="d-block"><p>left <strong>bold</strong> text</p></div>' +
  '</div>' +
  '<div data-type="column" data-position="right">' +
  '<div data-type="d-block"><p>right text</p></div>' +
  '<div data-type="d-block"><p>second para</p></div>' +
  '</div>' +
  '</div>';

describe('columns export (styles mode)', () => {
  it('keeps the div structure with data-layout and data-position', () => {
    const md = exportStyled(columnsHtml);
    expect(md).toContain(
      '<div data-type="columns" data-layout="align-center">',
    );
    expect(md).toContain('<div data-type="column" data-position="left">');
    expect(md).toContain('<div data-type="column" data-position="right">');
    expect((md.match(/<\/div>/g) || []).length).toBe(3);
  });

  it('serializes inner content as markdown separated by blank lines', () => {
    const md = exportStyled(columnsHtml);
    expect(md).toContain('left **bold** text');
    expect(md).toMatch(/<div data-type="column"[^>]*>\n\n/);
    expect(md).toMatch(/\n\n<\/div>/);
  });

  it('flattens columns in plain (non-styles) export', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(columnsHtml);
    expect(md).not.toContain('<div');
    expect(md).toContain('left **bold** text');
    expect(md).toContain('right text');
  });
});

describe('columns import round-trip', () => {
  const md = new MarkdownIt({ html: true });

  it('markdown-it re-parses inner markdown into HTML inside the divs', () => {
    const exported = exportStyled(columnsHtml);
    const html = md.render(exported);
    expect(html).toContain('data-type="columns"');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<p>right text</p>');
  });

  it('schema-parses back into a columns node with layout and positions', () => {
    const schema = getSchema([
      StarterKit.configure({ document: false }),
      Document,
      DBlock,
      Columns,
      Column,
      PageBreak,
    ]);
    const exported = exportStyled(columnsHtml);
    const rendered = md.render(exported);
    const dom = document.implementation.createHTMLDocument();
    dom.body.innerHTML = rendered;
    const doc = PMDOMParser.fromSchema(schema).parse(dom.body);

    let columns: PMNode | null = null;
    doc.descendants((node) => {
      if (node.type.name === 'columns') {
        columns = node;
        return false;
      }
    });
    expect(columns).toBeTruthy();
    const cols = columns! as PMNode;
    expect(cols.attrs.layout).toBe('align-center');
    expect(cols.childCount).toBe(2);
    expect(cols.child(0).type.name).toBe('column');
    expect(cols.child(0).attrs.position).toBe('left');
    expect(cols.child(1).attrs.position).toBe('right');
    expect(cols.child(0).textContent).toContain('left bold text');
    expect(cols.child(1).textContent).toContain('second para');
  });
});
