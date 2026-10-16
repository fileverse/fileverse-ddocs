// @vitest-environment jsdom
import { fromUint8Array } from 'js-base64';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  ACTIVE_TAB_STATE_KEY,
  getTabsYdocNodes,
  syncTabState,
} from '../components/tabs/utils/tab-utils';
import { writeJSONContentToYjsField } from '../hooks/use-headless-editor';
import { describeDdocContent, mergeRanges } from './content-fingerprint';
import { getDdocContentFingerprint } from './ddoc-persistence';

const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** A two-tab dDoc written through the package's own tab and content code. */
const twoTabDoc = () => {
  const doc = new Y.Doc();
  writeJSONContentToYjsField({
    content: paragraph('hello world'),
    field: 'tab-1',
    schemaVersion: 1,
    ydoc: doc,
  });
  writeJSONContentToYjsField({
    content: paragraph('second tab'),
    field: 'tab-2',
    schemaVersion: 1,
    ydoc: doc,
  });
  const tabs = getTabsYdocNodes(doc);
  doc.transact(() => {
    tabs.order.push(['tab-1', 'tab-2']);
    tabs.nameById.set('tab-1', 'Tab 1');
    tabs.nameById.set('tab-2', 'Tab 2');
    tabs.tabState.set(ACTIVE_TAB_STATE_KEY, 'tab-1');
  });
  syncTabState(doc);
  return doc;
};

const switchTab = (doc: Y.Doc, tabId: string) =>
  doc.transact(() => {
    getTabsYdocNodes(doc).tabState.set(ACTIVE_TAB_STATE_KEY, tabId);
  }, 'self');

/** First text node in a tab (paragraphs sit inside block wrappers). */
const firstText = (doc: Y.Doc, tabId: string): Y.XmlText => {
  const visit = (node: Y.XmlFragment | Y.XmlElement): Y.XmlText | null => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) return child;
      if (child instanceof Y.XmlElement) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  };
  const text = visit(doc.getXmlFragment(tabId));
  if (!text) throw new Error(`no text in ${tabId}`);
  return text;
};

const encode = (doc: Y.Doc) => fromUint8Array(Y.encodeStateAsUpdate(doc));
const fingerprint = (doc: Y.Doc) => getDdocContentFingerprint(encode(doc));

const reload = (doc: Y.Doc, options?: { gc: boolean }) => {
  const copy = new Y.Doc(options);
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};

describe('content fingerprint', () => {
  it('is 44 characters', async () => {
    expect(await fingerprint(twoTabDoc())).toHaveLength(44);
  });

  it('does not change when the active tab changes', async () => {
    const doc = twoTabDoc();
    const before = await fingerprint(doc);
    switchTab(doc, 'tab-2');
    switchTab(doc, 'tab-1');
    switchTab(doc, 'tab-2');
    expect(await fingerprint(doc)).toBe(before);
  });

  it("does not change when another client's active tab changes", async () => {
    const doc = twoTabDoc();
    const before = await fingerprint(doc);
    const other = reload(doc);
    switchTab(other, 'tab-2');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    expect(await fingerprint(doc)).toBe(before);
  });

  it('treats a doc whose only write is the active tab as empty', () => {
    const doc = new Y.Doc();
    const empty = describeDdocContent(doc);
    switchTab(doc, 'tab-1');
    expect(describeDdocContent(doc)).toBe(empty);
  });

  it('changes on insert, delete only, format only and tab rename', async () => {
    const doc = twoTabDoc();
    const seen = new Set([await fingerprint(doc)]);
    const expectNew = async () => {
      const value = await fingerprint(doc);
      expect(seen.has(value)).toBe(false);
      seen.add(value);
    };

    firstText(doc, 'tab-1').insert(11, '!');
    await expectNew();
    firstText(doc, 'tab-1').delete(0, 6);
    await expectNew();
    firstText(doc, 'tab-1').format(0, 5, { bold: true });
    await expectNew();
    getTabsYdocNodes(doc).nameById.set('tab-2', 'Renamed');
    await expectNew();
  });

  it('changes when a whole paragraph is deleted', async () => {
    const doc = twoTabDoc();
    writeJSONContentToYjsField({
      content: {
        type: 'doc',
        content: ['one', 'two', 'three'].map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })),
      },
      field: 'tab-3',
      schemaVersion: 1,
      ydoc: doc,
    });
    const before = await fingerprint(doc);
    doc.getXmlFragment('tab-3').delete(1, 1);
    const after = await fingerprint(doc);
    expect(after).not.toBe(before);
    expect(await fingerprint(reload(doc))).toBe(after);
  });

  it('counts a root it has never heard of', async () => {
    const doc = twoTabDoc();
    const before = await fingerprint(doc);
    doc.getMap('someFutureRoot').set('key', 'value');
    expect(await fingerprint(doc)).not.toBe(before);
  });

  it('changes when another client edits', async () => {
    const doc = twoTabDoc();
    const before = await fingerprint(doc);
    const other = reload(doc);
    firstText(other, 'tab-2').insert(0, 'x');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
    expect(await fingerprint(doc)).not.toBe(before);
  });

  it('is the same for the same state however it was produced', async () => {
    const doc = twoTabDoc();
    firstText(doc, 'tab-1').insert(0, 'edited ');
    switchTab(doc, 'tab-2');
    firstText(doc, 'tab-2').delete(0, 3);
    const live = describeDdocContent(doc);

    const full = Y.encodeStateAsUpdate(doc);
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.mergeUpdates([full, full]));

    const stepwise = new Y.Doc();
    const source = new Y.Doc();
    source.on('update', (update: Uint8Array) =>
      Y.applyUpdate(stepwise, update),
    );
    Y.applyUpdate(source, full);

    expect(describeDdocContent(reload(doc))).toBe(live);
    expect(describeDdocContent(merged)).toBe(live);
    expect(describeDdocContent(stepwise)).toBe(live);
    expect(describeDdocContent(reload(doc, { gc: false }))).toBe(live);
  });

  it('notices an edit typed after a tab switch', async () => {
    const doc = twoTabDoc();
    const published = await fingerprint(doc);
    switchTab(doc, 'tab-2');
    expect(await fingerprint(doc)).toBe(published);
    firstText(doc, 'tab-2').insert(0, 'new ');
    expect(await fingerprint(doc)).not.toBe(published);
  });

  it('writes touching ranges one way and keeps gaps', () => {
    expect(
      mergeRanges([
        [0, 3],
        [3, 5],
        [6, 8],
        [8, 9],
      ]),
    ).toEqual([
      [0, 5],
      [6, 9],
    ]);
    expect(mergeRanges([])).toEqual([]);
  });

  it('gives the same description for random edits by two clients, however the state is loaded', () => {
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    for (let trial = 0; trial < 60; trial++) {
      const a = new Y.Doc();
      const b = new Y.Doc();
      for (let step = 0; step < 60; step++) {
        const doc = next(2) === 0 ? a : b;
        const text = doc.getText('t');
        const op = next(10);
        if (op < 4 || text.length === 0) {
          text.insert(next(text.length + 1), 'abcde'.slice(0, 1 + next(5)));
        } else if (op < 7) {
          const at = next(text.length);
          text.delete(at, 1 + next(Math.min(4, text.length - at)));
        } else if (op < 8) {
          const at = next(text.length);
          text.format(at, 1 + next(Math.min(3, text.length - at)), {
            bold: next(2) === 0 ? true : null,
          });
        } else if (op < 9) {
          switchTab(doc, `tab-${next(3)}`);
        } else {
          Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
          Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
        }
      }
      Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
      Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

      const live = describeDdocContent(a);
      const merged = new Y.Doc();
      Y.applyUpdate(
        merged,
        Y.mergeUpdates([Y.encodeStateAsUpdate(b), Y.encodeStateAsUpdate(a)]),
      );
      expect(describeDdocContent(b)).toBe(live);
      expect(describeDdocContent(reload(a))).toBe(live);
      expect(describeDdocContent(merged)).toBe(live);
      expect(describeDdocContent(reload(a, { gc: false }))).toBe(live);
    }
  });
});
