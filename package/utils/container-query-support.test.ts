import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return (await import('./container-query-support'))
    .canUseEditorContainerQueries;
};

const stubFixedChildLeft = (left: number) =>
  vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const isProbeChild = this.style.position === 'fixed';
      return { left: isProbeChild ? left : 0, top: 0 } as DOMRect;
    });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('canUseEditorContainerQueries', () => {
  it('is false when container queries are not supported', async () => {
    vi.stubGlobal('CSS', { supports: () => false });
    expect((await load())()).toBe(false);
  });

  it('is true when a fixed child escapes the container', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    stubFixedChildLeft(0);
    expect((await load())()).toBe(true);
  });

  it('is false when a fixed child is trapped in the container', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    stubFixedChildLeft(40);
    expect((await load())()).toBe(false);
  });

  it('leaves no test element behind and measures once', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const rect = stubFixedChildLeft(0);
    const check = await load();
    check();
    check();
    expect(rect).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-ddoc-cq-probe]')).toBeNull();
  });
});
