import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import { EditorNavbar } from './editor-navbar';

const editor = { getJSON: () => ({ type: 'doc' }) } as unknown as Editor;

const renderNavbar = () => <span>host navbar</span>;

describe('EditorNavbar', () => {
  it('renders the host navbar in flow inside the unstyled collapse row', () => {
    const { container } = render(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        isHidden={false}
      />,
    );
    expect(container.innerHTML).toBe(
      '<div class="ddoc-navbar-row"><span>host navbar</span></div>',
    );
  });

  it('renders nothing without a renderer', () => {
    const { container } = render(
      <EditorNavbar editor={editor} isHidden={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while the container is null', () => {
    const { container } = render(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        container={null}
        isHidden={false}
      />,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('host navbar')).toBeNull();
  });

  it('portals into the container and follows it when replaced', () => {
    const first = document.body.appendChild(document.createElement('div'));
    const second = document.body.appendChild(document.createElement('div'));
    const { container, rerender } = render(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        container={first}
        isHidden={false}
      />,
    );
    expect(container.innerHTML).toBe('');
    expect(first.innerHTML).toBe('<span>host navbar</span>');

    rerender(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        container={second}
        isHidden={false}
      />,
    );
    expect(first.innerHTML).toBe('');
    expect(second.innerHTML).toBe('<span>host navbar</span>');
  });

  it('collapses the in-flow row when hidden, keeping the navbar mounted', () => {
    const { container } = render(
      <EditorNavbar editor={editor} renderNavbar={renderNavbar} isHidden />,
    );
    expect(container.firstElementChild?.className).toBe(
      'ddoc-navbar-row ddoc-navbar-row--hidden',
    );
    expect(screen.getByText('host navbar')).toBeTruthy();
  });

  it('renders nothing for a hidden portalled navbar', () => {
    const host = document.body.appendChild(document.createElement('div'));
    render(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        container={host}
        isHidden
      />,
    );
    expect(host.innerHTML).toBe('');
  });
});
