/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Emoji } from 'emojibase';

// ~880 KB of JSON: load it on the first emoji query, not with the editor.
let emojiData: Promise<Emoji[]> | undefined;
const loadEmojiData = () =>
  (emojiData ??= import('emojibase-data/en/data.json').then(
    (m) => m.default as Emoji[],
  ));

function isRegionalIndicator(emoji: any) {
  return emoji.label.includes('regional');
}

export async function emojiSearch(
  query: string,
): Promise<{ name: string; emoji: string }[]> {
  const filteredEmojiData = (await loadEmojiData()).filter(
    (emoji) => !isRegionalIndicator(emoji),
  );

  if (!query) {
    const smilingEmojis = filteredEmojiData
      .filter((emoji) => emoji.group === 0)
      .slice(0, 10)
      .map((emoji) => ({
        name: emoji.shortcodes?.[0] || emoji.label,
        emoji: emoji.emoji,
      }));

    return smilingEmojis;
  }

  const lowercaseQuery = query.toLowerCase();

  const matches = filteredEmojiData
    .filter(
      (emoji) =>
        emoji.shortcodes?.some((code) => code.startsWith(lowercaseQuery)) ||
        emoji.label?.toLowerCase().includes(lowercaseQuery) ||
        emoji.tags?.some((tag) => tag.includes(lowercaseQuery)),
    )
    .map((emoji) => ({
      name: emoji.shortcodes?.[0] || emoji.label,
      emoji: emoji.emoji,
    }));

  return matches;
}
