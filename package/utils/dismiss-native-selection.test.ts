import { describe, it, expect, beforeEach } from 'vitest';
import { dismissNativeSelection } from './dismiss-native-selection';

const makeEditable = () => {
  const dom = document.createElement('div');
  dom.contentEditable = 'true';
  dom.tabIndex = 0;
  dom.textContent = 'Hello mobile fonts';
  document.body.appendChild(dom);
  return dom;
};

describe('dismissNativeSelection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  // iOS/Android keep their edit menu + handles for any live DOM range in a
  // contenteditable, focused or not, so opening a sheet must drop the range.
  it('blurs the editor and removes the DOM selection range', () => {
    const dom = makeEditable();
    dom.focus();
    const range = document.createRange();
    range.selectNodeContents(dom);
    window.getSelection()?.addRange(range);
    expect(window.getSelection()?.rangeCount).toBe(1);

    dismissNativeSelection({ view: { dom } });

    expect(document.activeElement).not.toBe(dom);
    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it('leaves a selection that lives outside the editor alone', () => {
    const dom = makeEditable();
    const other = document.createElement('p');
    other.textContent = 'elsewhere';
    document.body.appendChild(other);
    const range = document.createRange();
    range.selectNodeContents(other);
    window.getSelection()?.addRange(range);

    dismissNativeSelection({ view: { dom } });

    expect(window.getSelection()?.rangeCount).toBe(1);
  });

  it('is a no-op without an editor', () => {
    expect(() => dismissNativeSelection(null)).not.toThrow();
  });
});
