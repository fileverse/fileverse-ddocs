// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMoreTemplates, createTemplateButtons } from './template-utils';

describe('template picker ordering', () => {
  it('shows Breathe and Fanfic as quick templates', () => {
    const addTemplate = vi.fn();
    const addTabbedTemplate = vi.fn();
    const buttons = createTemplateButtons(addTemplate, addTabbedTemplate);

    expect(buttons.map((button) => button.label)).toEqual([
      'Breathe!',
      'Fanfic',
    ]);
    buttons[1].onClick();
    expect(addTabbedTemplate).toHaveBeenCalledOnce();
    expect(addTemplate).not.toHaveBeenCalled();
  });

  it('moves To-do to the first dropdown position', () => {
    const templates = createMoreTemplates(vi.fn());
    expect(templates[0].label).toBe('To-do');
  });
});
