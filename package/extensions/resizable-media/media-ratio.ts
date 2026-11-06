// Pages mode narrows media taller than a page so it keeps its shape
// (docs/PAGES_MODE.md §13.5). CSS cannot read a stored width or a natural
// size, so the screen node view and the print copy publish the ratio here.
export const MEDIA_RATIO_VAR = '--ddoc-media-ratio';

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const ratioOf = (width: unknown, height: unknown) => {
  const w = positive(width);
  const h = positive(height);
  return w && h ? w / h : undefined;
};

// Width over height: an image's or video's natural size, else its numeric
// width and height attributes (an iframe has no natural size).
export const readMediaRatio = (el: Element): number | undefined => {
  if (el instanceof HTMLImageElement) {
    const natural = ratioOf(el.naturalWidth, el.naturalHeight);
    if (natural) return natural;
  } else if (el instanceof HTMLVideoElement) {
    const natural = ratioOf(el.videoWidth, el.videoHeight);
    if (natural) return natural;
  }
  return ratioOf(el.getAttribute('width'), el.getAttribute('height'));
};

// Sets the ratio on each media element under root (or on `target`, for a box
// holding one) now, and again when one loads (load and loadedmetadata do not
// bubble, so this listens in capture).
export const publishMediaRatios = (
  root: HTMLElement,
  target?: HTMLElement,
): (() => void) => {
  const apply = (el: Element) => {
    const ratio = readMediaRatio(el);
    const holder = target ?? el;
    if (ratio && holder instanceof HTMLElement) {
      holder.style.setProperty(MEDIA_RATIO_VAR, String(ratio));
    }
  };
  root.querySelectorAll('img, video, iframe').forEach(apply);
  const onLoad = (event: Event) => {
    if (event.target instanceof Element) apply(event.target);
  };
  root.addEventListener('load', onLoad, true);
  root.addEventListener('loadedmetadata', onLoad, true);
  return () => {
    root.removeEventListener('load', onLoad, true);
    root.removeEventListener('loadedmetadata', onLoad, true);
  };
};
