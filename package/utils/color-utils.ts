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

/**
 * The paste clean-up's test. Tiptap 3.20+ stores a pasted colour as authored
 * (`#333`) where browsers used to hand us `rgb(51, 51, 51)`, so hex is judged
 * by its rgb() form only, never by the hex list.
 */
export const isPastedBlackOrWhiteShade = (color: string) =>
  isBlackOrWhiteShade(hexToRgb(color) ?? color);

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
