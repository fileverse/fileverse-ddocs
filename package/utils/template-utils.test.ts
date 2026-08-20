// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMoreTemplates, createTemplateButtons } from './template-utils';

describe('template picker ordering', () => {
  it('uses the main-branch quick templates by default', () => {
    const addTemplate = vi.fn();
    const buttons = createTemplateButtons(addTemplate);
    const moreTemplates = createMoreTemplates(addTemplate);

    expect(buttons.map((button) => button.label)).toEqual([
      'To-do',
      'Breathe!',
    ]);
    expect(moreTemplates.map((button) => button.label)).not.toContain('To-do');
    expect(buttons.map((button) => button.label)).not.toContain('Fanfic');
  });

  it('shows Breathe and Fanfic when Fanfic is enabled', () => {
    const addTemplate = vi.fn();
    const addTabbedTemplate = vi.fn();
    const buttons = createTemplateButtons(addTemplate, addTabbedTemplate, true);
    const moreTemplates = createMoreTemplates(addTemplate, true);

    expect(buttons.map((button) => button.label)).toEqual([
      'Breathe!',
      'Fanfic',
    ]);
    expect(moreTemplates[0].label).toBe('To-do');
    buttons[1].onClick();
    expect(addTabbedTemplate).toHaveBeenCalledOnce();
    expect(addTemplate).not.toHaveBeenCalled();
  });
});
