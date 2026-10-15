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
