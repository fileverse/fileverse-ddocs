import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { EditorNavbar } from './editor-navbar';

const editor = {
  getJSON: () => ({ type: 'doc' }),
  commands: { focus: vi.fn() },
} as unknown as Editor;

const renderNavbar = () => <span>host navbar</span>;

describe('EditorNavbar', () => {
  it('renders in flow when no container prop is passed', () => {
    const { container } = render(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        isHidden={false}
      />,
    );
    expect(container.querySelector('nav#Navbar')).not.toBeNull();
    expect(screen.getByText('host navbar')).toBeTruthy();
  });

  it('renders nothing without a renderer', () => {
    const { container } = render(
      <EditorNavbar editor={editor} isHidden={false} />,
    );
    expect(container.querySelector('nav')).toBeNull();
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
    expect(container.querySelector('nav')).toBeNull();
    expect(first.querySelector('nav#Navbar')).not.toBeNull();
    rerender(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        container={second}
        isHidden={false}
      />,
    );
    expect(first.querySelector('nav')).toBeNull();
    expect(second.querySelector('nav#Navbar')).not.toBeNull();
  });

  it('collapses when hidden', () => {
    const { container } = render(
      <EditorNavbar editor={editor} renderNavbar={renderNavbar} isHidden />,
    );
    expect(container.querySelector('nav')?.className).toContain('hidden');
  });

  it('returns focus to the editor on Escape', () => {
    const { container } = render(
      <EditorNavbar
        editor={editor}
        renderNavbar={renderNavbar}
        isHidden={false}
      />,
    );
    fireEvent.keyDown(container.querySelector('nav')!, { key: 'Escape' });
    expect(editor.commands.focus).toHaveBeenCalled();
  });
});
