/**
 * SVG files authored with `width="100%"` (or no width at all) and no height
 * carry no concrete intrinsic dimensions — only a viewBox ratio. Firefox
 * renders such a file at 0 height inside the editor's media wrapper (the
 * upload succeeds and the image paints nothing), and every browser falls
 * back to a 300px default box instead of the drawing's natural size.
 *
 * `normalizeSvgDimensions` pins numeric width/height derived from the
 * viewBox onto the root element so the stored file is self-describing.
 * Fail-open: any input we cannot confidently improve is returned unchanged.
 */

const isConcreteLength = (value: string | null): value is string => {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.includes('%')) return false;
  return parseFloat(trimmed) > 0;
};

const round2 = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Returns the normalized SVG text, or null when the input needs no change
 * (already has concrete width+height, has no usable viewBox, or is not
 * parseable as a lone <svg> document).
 */
export const normalizeSvgDimensions = (svgText: string): string | null => {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (
    !root ||
    root.nodeName.toLowerCase() !== 'svg' ||
    doc.getElementsByTagName('parsererror').length > 0
  ) {
    return null;
  }

  const attrWidth = root.getAttribute('width');
  const attrHeight = root.getAttribute('height');
  if (isConcreteLength(attrWidth) && isConcreteLength(attrHeight)) {
    return null;
  }

  const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/);
  const vbW = parseFloat(box[2]);
  const vbH = parseFloat(box[3]);
  if (!(vbW > 0) || !(vbH > 0)) return null;

  let width: number;
  let height: number;
  if (isConcreteLength(attrWidth)) {
    width = parseFloat(attrWidth);
    height = (width * vbH) / vbW;
  } else if (isConcreteLength(attrHeight)) {
    height = parseFloat(attrHeight);
    width = (height * vbW) / vbH;
  } else {
    width = vbW;
    height = vbH;
  }

  root.setAttribute('width', round2(width));
  root.setAttribute('height', round2(height));
  return new XMLSerializer().serializeToString(root);
};

// Blob.text() is missing from some environments (jsdom included) — fall
// back to FileReader, which is universal.
export const readFileText = (file: File): Promise<string> => {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
};

/**
 * File-level wrapper for the upload lanes. Returns the original File
 * untouched unless it is an SVG whose dimensions were pinned.
 */
export const normalizeSvgFile = async (file: File): Promise<File> => {
  if (file.type !== 'image/svg+xml') return file;
  try {
    const text = await readFileText(file);
    const normalized = normalizeSvgDimensions(text);
    if (!normalized) return file;
    return new File([normalized], file.name, { type: file.type });
  } catch {
    return file;
  }
};
