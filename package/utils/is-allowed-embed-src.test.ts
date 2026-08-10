import { describe, expect, it } from 'vitest';
import {
  isAllowedEmbedSrc,
  recommendedEmbedFrameSrcCsp,
} from './is-allowed-embed-src';

describe('isAllowedEmbedSrc', () => {
  it('accepts allowlisted https embed hosts/paths', () => {
    expect(
      isAllowedEmbedSrc('https://www.youtube.com/embed/dQw4w9WgXcQ'),
    ).toBe(true);
    expect(
      isAllowedEmbedSrc('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'),
    ).toBe(true);
    expect(isAllowedEmbedSrc('https://player.vimeo.com/video/123456')).toBe(
      true,
    );
    expect(
      isAllowedEmbedSrc(
        'https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/1',
      ),
    ).toBe(true);
  });

  it('rejects arbitrary third-party frames', () => {
    expect(isAllowedEmbedSrc('https://evil.example/payload')).toBe(false);
    expect(isAllowedEmbedSrc('https://evil.example/embed/x')).toBe(false);
    expect(isAllowedEmbedSrc('javascript:alert(1)')).toBe(false);
    expect(isAllowedEmbedSrc('data:text/html,<script>alert(1)</script>')).toBe(
      false,
    );
    expect(isAllowedEmbedSrc('https://www.youtube.com/watch?v=x')).toBe(false);
    expect(isAllowedEmbedSrc('https://youtube.com/')).toBe(false);
  });

  it('rejects http even for allowlisted hosts', () => {
    expect(isAllowedEmbedSrc('http://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      false,
    );
    expect(isAllowedEmbedSrc('http://player.vimeo.com/video/123')).toBe(false);
  });

  it('rejects non-strings and invalid URLs', () => {
    expect(isAllowedEmbedSrc(null)).toBe(false);
    expect(isAllowedEmbedSrc(undefined)).toBe(false);
    expect(isAllowedEmbedSrc('')).toBe(false);
    expect(isAllowedEmbedSrc('not-a-url')).toBe(false);
  });
});

describe('recommendedEmbedFrameSrcCsp', () => {
  it('includes self and allowlisted https origins', () => {
    const value = recommendedEmbedFrameSrcCsp();
    expect(value).toContain("'self'");
    expect(value).toContain('https://www.youtube.com');
    expect(value).toContain('https://player.vimeo.com');
    expect(value).toContain('https://w.soundcloud.com');
    expect(value).not.toContain('http://');
  });

  it('merges extra origins', () => {
    const value = recommendedEmbedFrameSrcCsp(['https://cdn.example']);
    expect(value).toContain('https://cdn.example');
  });
});
