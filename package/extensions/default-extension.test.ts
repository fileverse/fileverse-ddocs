import { describe, it, expect } from 'vitest';
import { defaultExtensions } from './default-extension';

const extensionNames = (schemaVersion: number) =>
  defaultExtensions({ onError: () => null, schemaVersion }).map(
    (extension) => (extension as { name: string }).name,
  );

describe('defaultExtensions schema fork', () => {
  it('drops the gap cursor from the flat v2 set', () => {
    // The flat schema exposes gap positions at every boundary between two
    // non-textblock blocks (image→table, table→table, before embeds), where
    // the gap cursor renders as a stray dash glued to the next block's
    // border while being unreachable by deliberate input (TEC-2679).
    // Inserting between blocks is the plus button's job, Notion-style.
    expect(extensionNames(2)).not.toContain('gapCursor');
  });

  it('keeps the gap cursor in the v1 set (legacy behavior unchanged)', () => {
    expect(extensionNames(1)).toContain('gapCursor');
  });

  it.each([1, 2])(
    'registers paragraph spacing for schema v%i',
    (schemaVersion) => {
      // v1 documents are the installed base; a toolbar control that silently
      // does nothing on them is worse than not shipping it.
      expect(extensionNames(schemaVersion)).toContain('paragraphSpacing');
    },
  );
});
