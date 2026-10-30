import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SecureImageV2 } from './secure-image-v2';

const props = {
  encryptionKey: 'k',
  url: 'u',
  nonce: 'n',
  authTag: 't',
  ipfsHash: 'h',
  mimeType: 'image/png',
};
const loaded = {
  url: 'blob:loaded',
  file: new File(['x'], 'x.png', { type: 'image/png' }),
};

const advance = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
const imageSrc = () =>
  screen.queryByRole('img')?.getAttribute('src') ?? undefined;
const errorShown = () => screen.queryByText('Failed to load image') !== null;

describe('SecureImageV2', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pins the retry jitter to the base delay.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries a failed load once and then shows the image', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('gateway'))
      .mockResolvedValue(loaded);
    render(<SecureImageV2 {...props} ipfsImageFetchFn={fetchFn} />);

    await advance();
    expect(imageSrc()).toBeUndefined();
    await advance(4000);

    expect(imageSrc()).toBe('blob:loaded');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shows the error when the retry fails too, and loads again on Retry', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('gateway'));
    render(<SecureImageV2 {...props} ipfsImageFetchFn={fetchFn} />);

    await advance();
    await advance(4000);
    expect(errorShown()).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    fetchFn.mockResolvedValue(loaded);
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry loading image' }),
    );
    await advance();

    expect(imageSrc()).toBe('blob:loaded');
    expect(errorShown()).toBe(false);
  });

  it('shows the error for a load that hangs, then the image if it finishes late', async () => {
    const fetchFn = vi.fn(
      () =>
        new Promise<typeof loaded>((resolve) =>
          setTimeout(() => resolve(loaded), 70000),
        ),
    );
    render(<SecureImageV2 {...props} ipfsImageFetchFn={fetchFn} />);

    await advance(60000);
    expect(errorShown()).toBe(true);
    await advance(10000);

    expect(imageSrc()).toBe('blob:loaded');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once unmounted', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('gateway'));
    const { unmount } = render(
      <SecureImageV2 {...props} ipfsImageFetchFn={fetchFn} />,
    );

    await advance();
    unmount();
    await advance(10000);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('revokes a result that arrives after unmount', async () => {
    let resolveLoad!: (value: typeof loaded) => void;
    const fetchFn = vi.fn(
      () => new Promise<typeof loaded>((resolve) => (resolveLoad = resolve)),
    );
    const { unmount } = render(
      <SecureImageV2 {...props} ipfsImageFetchFn={fetchFn} />,
    );

    await advance();
    unmount();
    resolveLoad(loaded);
    await advance();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:loaded');
  });

  it('clears the error when the node gets a different image', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('gateway'));
    const { rerender } = render(
      <SecureImageV2 {...props} ipfsImageFetchFn={fetchFn} />,
    );
    await advance();
    await advance(4000);
    expect(errorShown()).toBe(true);

    fetchFn.mockResolvedValue({ ...loaded, url: 'blob:other' });
    rerender(<SecureImageV2 {...props} url="u2" ipfsImageFetchFn={fetchFn} />);
    await advance();

    expect(imageSrc()).toBe('blob:other');
    expect(errorShown()).toBe(false);
  });
});
