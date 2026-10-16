import { emojiSearch } from './emoji-utils';

describe('emojiSearch', () => {
  it('returns smileys for an empty query', async () => {
    const results = await emojiSearch('');
    expect(results).toHaveLength(10);
    expect(results[0]).toEqual({
      name: expect.any(String),
      emoji: expect.any(String),
    });
  });

  it('matches by shortcode', async () => {
    const results = await emojiSearch('rocket');
    expect(results.map((r) => r.emoji)).toContain('🚀');
  });

  it('skips regional indicators', async () => {
    const results = await emojiSearch('regional');
    expect(results).toHaveLength(0);
  });
});

describe('emojiSearch when the data chunk fails to load', () => {
  afterEach(() => {
    vi.doUnmock('emojibase-data/en/data.json');
    vi.resetModules();
  });

  it('retries on the next query instead of caching the failure', async () => {
    let fail = true;
    vi.resetModules();
    vi.doMock('emojibase-data/en/data.json', () => {
      if (fail) throw new Error('chunk load failed');
      return { default: [{ label: 'rocket', emoji: '🚀', group: 0 }] };
    });
    const { emojiSearch: search } = await import('./emoji-utils');

    await expect(search('rocket')).rejects.toThrow();
    fail = false;
    expect((await search('rocket')).map((r) => r.emoji)).toEqual(['🚀']);
  });
});
