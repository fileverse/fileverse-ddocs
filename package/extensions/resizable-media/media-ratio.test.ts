import {
  MEDIA_RATIO_VAR,
  publishMediaRatios,
  readMediaRatio,
} from './media-ratio';

const el = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
};

describe('media ratio', () => {
  it('reads an image natural size before its attributes', () => {
    const img = el('<img width="600" height="300">').firstElementChild!;
    expect(readMediaRatio(img)).toBe(2);
    Object.defineProperty(img, 'naturalWidth', { value: 400 });
    Object.defineProperty(img, 'naturalHeight', { value: 2000 });
    expect(readMediaRatio(img)).toBe(0.2);
  });

  it('has no ratio without a natural size or numeric attributes', () => {
    const img = el('<img width="100%" height="auto">').firstElementChild!;
    expect(readMediaRatio(img)).toBeUndefined();
  });

  it('publishes on the target now and when the media loads', () => {
    const root = el('<img width="100%">');
    const img = root.firstElementChild as HTMLImageElement;
    const stop = publishMediaRatios(root, root);
    expect(root.style.getPropertyValue(MEDIA_RATIO_VAR)).toBe('');
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 600 });
    img.dispatchEvent(new Event('load'));
    expect(root.style.getPropertyValue(MEDIA_RATIO_VAR)).toBe('0.5');
    stop();
  });

  it('publishes on each media element without a target', () => {
    const root = el('<iframe width="602" height="1400"></iframe>');
    publishMediaRatios(root)();
    const iframe = root.firstElementChild as HTMLElement;
    expect(Number(iframe.style.getPropertyValue(MEDIA_RATIO_VAR))).toBeCloseTo(
      0.43,
    );
  });
});
