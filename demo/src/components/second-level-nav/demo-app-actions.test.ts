import { describe, it, expect, vi } from 'vitest';
import { createDemoAppActions } from './demo-app-actions';

describe('demo app actions', () => {
  it('file.print runs the editor ref printCurrentTab', () => {
    const printCurrentTab = vi.fn();
    const actions = createDemoAppActions({
      printCurrentTab,
    } as unknown as Parameters<typeof createDemoAppActions>[0]);
    actions['file.print'].run();
    expect(printCurrentTab).toHaveBeenCalledTimes(1);
  });
});
