import { afterEach, describe, expect, it, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return (await import('./container-query-support'))
    .canUseEditorContainerQueries;
};

const BOX = { left: 40, top: 40 };

// The probe box reports `box`; its fixed child reports `child`.
const stubProbeRects = (
  child: { left: number; top: number },
  box: { left: number; top: number } = BOX,
) =>
  vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return (this.style.position === 'fixed' ? child : box) as DOMRect;
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
    stubProbeRects({ left: 0, top: 0 });
    expect((await load())()).toBe(true);
  });

  it('is false when a fixed child is trapped in the container', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    stubProbeRects(BOX);
    expect((await load())()).toBe(false);
  });

  // A scrolled page moves the box; only the child's offset from it counts.
  it('is false when trapped on a scrolled page', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const scrolledBox = { left: -260, top: -960 };
    stubProbeRects(scrolledBox, scrolledBox);
    expect((await load())()).toBe(false);
  });

  it('is true when escaped on a scrolled page', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    stubProbeRects({ left: 0, top: 0 }, { left: -260, top: -960 });
    expect((await load())()).toBe(true);
  });

  it('leaves no test element behind and measures once', async () => {
    vi.stubGlobal('CSS', { supports: () => true });
    const rect = stubProbeRects({ left: 0, top: 0 });
    const check = await load();
    expect(check()).toBe(true);
    const measured = rect.mock.calls.length;
    expect(measured).toBeGreaterThan(0);
    expect(check()).toBe(true);
    expect(rect).toHaveBeenCalledTimes(measured);
    expect(document.body.querySelector('[data-ddoc-cq-probe]')).toBeNull();
  });
});
