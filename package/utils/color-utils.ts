export const isBlackOrWhiteShade = (color: string) => {
  // Handle rgb format
  if (color.startsWith('rgb')) {
    const rgbValues = color.match(/\d+/g);
    if (rgbValues && rgbValues.length === 3) {
      const [r, g, b] = rgbValues.map(Number);

      // Check if all RGB values are equal (indicating a gray shade)
      if (r === g && g === b) {
        // Consider it a black/white shade if:
        // - Very dark (close to black): all values < 30
        // - Very light (close to white): all values > 240
        // - Gray shades: all values between 60-180
        return r < 30 || r > 240 || (r >= 60 && r <= 180);
      }
    }
    return false;
  }

  // Handle hex colors
  color = color.toLowerCase();
  const blackShades = ['#000000', '#434343', '#666666', '#999999'].map((c) =>
    c.toLowerCase(),
  );
  const whiteShades = [
    '#ffffff',
    '#f3f3f3',
    '#efefef',
    '#d9d9d9',
    '#cccccc',
    '#b7b7b7',
  ].map((c) => c.toLowerCase());

  return blackShades.includes(color) || whiteShades.includes(color);
};

const hexToRgb = (hex: string): string | null => {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex);
  if (!match) return null;
  const digits =
    match[1].length <= 4 ? match[1].replace(/./g, '$&$&') : match[1];
  const [r, g, b, a = 255] = [0, 2, 4, 6]
    .filter((i) => i < digits.length)
    .map((i) => Number.parseInt(digits.slice(i, i + 2), 16));
  return a === 255
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
};

const hslToRgb = (
  h: number,
  s: number,
  l: number,
): [number, number, number] => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [
    number,
    number,
    number,
  ];
};

const FUNCTIONAL_COLOR =
  /^(rgba?|hsla?)\(\s*([^\s,/)]+)[\s,]+([^\s,/)]+)[\s,]+([^\s,/)]+)(?:\s*[,/]\s*([^\s,/)]+))?\s*\)$/i;

const toUnit = (value: string, scale: number) =>
  value.endsWith('%') ? Number.parseFloat(value) / 100 : Number(value) / scale;

const functionalToRgb = (color: string): string | null => {
  const m = FUNCTIONAL_COLOR.exec(color.trim());
  if (!m) return null;
  const [, fn, c1, c2, c3, alpha] = m;
  let channels: number[];
  if (fn.toLowerCase().startsWith('rgb')) {
    channels = [c1, c2, c3].map((c) => Math.round(toUnit(c, 255) * 255));
  } else {
    const hue = ((Number.parseFloat(c1) % 360) + 360) % 360;
    channels = hslToRgb(hue, toUnit(c2, 100), toUnit(c3, 100));
  }
  const a = alpha === undefined ? 1 : toUnit(alpha, 1);
  if ([...channels, a].some(Number.isNaN)) return null;
  const [r, g, b] = channels.map((c) => Math.min(255, Math.max(0, c)));
  return a >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
};

const browserNormalizedColor = (color: string): string | null => {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('span');
  el.style.color = color;
  return el.style.color || null;
};

/**
 * The paste clean-up's test. Tiptap 3.20+ stores a pasted colour as authored
 * (`#333`, `hsl(...)`, `rgba(...)`) where browsers used to hand us
 * `rgb(51, 51, 51)`, so any CSS colour is judged by its rgb() form, never by
 * the hex list. Translucent colours stay `rgba(...)` and are kept.
 */
export const isPastedBlackOrWhiteShade = (color: string) =>
  isBlackOrWhiteShade(
    hexToRgb(color) ??
      functionalToRgb(color) ??
      browserNormalizedColor(color) ??
      color,
  );

export const getContrastColor = (hex: string): '#000000' | '#ffffff' => {
  // Remove hash and parse RGB
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  // Calculate sRGB values using the WCAG formula for gamma correction
  const getSRGB = (c: number) => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const R = getSRGB(r);
  const G = getSRGB(g);
  const B = getSRGB(b);

  // Apply weights for perceived luminance
  // Green is weighted highest as the eye is most sensitive to it
  const luminance = 0.2126 * R + 0.7152 * G + 0.0722 * B;

  // The threshold for mid-gray is 0.179.
  // Above this, use black. Below this, use white.
  return luminance > 0.179 ? '#000000' : '#ffffff';
};
