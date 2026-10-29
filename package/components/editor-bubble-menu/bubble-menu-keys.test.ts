import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageDir = path.resolve(__dirname, '../..');

// unregisterPlugin('bubbleMenu') drops every bubbleMenu$* plugin, so one menu
// unmounting with the default key kills the others until a reload.
describe('BubbleMenu plugin keys', () => {
  const keys = readdirSync(packageDir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .flatMap((file) => {
      const source = readFileSync(path.join(packageDir, file), 'utf8');
      return [...source.matchAll(/<BubbleMenu\b([^>]*)>/g)].map((tag) => ({
        file,
        key: /pluginKey="([^"]+)"/.exec(tag[1])?.[1],
      }));
    });

  it('finds the menus', () => {
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every BubbleMenu its own pluginKey', () => {
    for (const { file, key } of keys) {
      expect(key, file).toBeDefined();
      expect(key, file).not.toBe('bubbleMenu');
    }
    const names = keys.map(({ key }) => key);
    expect(new Set(names).size).toBe(names.length);
  });
});
