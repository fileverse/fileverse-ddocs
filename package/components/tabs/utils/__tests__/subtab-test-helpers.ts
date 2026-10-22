import * as Y from 'yjs';
import { fromUint8Array } from 'js-base64';
import { v7CreateTab, v7DeleteTab } from './v7/v7-tab-ops';
import { getTabsYdocNodes as v7GetTabsYdocNodes } from './v7/v7-tab-utils';

/** A doc with a fixed client id, so two runs of the same writes give equal bytes. */
export const makeDoc = (clientID = 1) => {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  return doc;
};

export const encode = (doc: Y.Doc) =>
  fromUint8Array(Y.encodeStateAsUpdate(doc));

export const copyDoc = (doc: Y.Doc, clientID = doc.clientID) => {
  const copy = makeDoc(clientID);
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
};

const block = (text: string, type = 'paragraph') => {
  const dBlock = new Y.XmlElement('dBlock');
  const node = new Y.XmlElement(type);
  node.insert(0, [new Y.XmlText(text)]);
  dBlock.insert(0, [node]);
  return dBlock;
};

export const writeText = (doc: Y.Doc, tabId: string, text: string) => {
  doc.transact(() => {
    const fragment = doc.getXmlFragment(tabId);
    fragment.insert(fragment.length, [block(text)]);
  });
};

/** Every word stored in the doc, in every tab's text, deleted tabs included. */
export const allStoredText = (doc: Y.Doc): string => {
  const parts: string[] = [];
  doc.share.forEach((_type, key) => {
    if (key.startsWith('tabs_') || key === 'ddocMeta' || key === 'ddocTabs') {
      return;
    }
    parts.push(doc.getXmlFragment(key).toString());
  });
  return parts.join('\n');
};

/** Sends each doc's missing updates to every other doc until they agree. */
export const syncAll = (...docs: Y.Doc[]) => {
  for (const from of docs) {
    for (const to of docs) {
      if (from === to) continue;
      Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
    }
  }
};

/*
 * Existing documents, built with the writes each past format used.
 * Each returns the encoded body the editor receives as initialContent.
 */

const v2Doc = () => {
  const doc = makeDoc(11);
  doc.transact(() => {
    doc.getMap('ddocMeta').set('schemaVersion', 2);
    const nodes = v7GetTabsYdocNodes(doc);
    nodes.nameById.set('default', 'Research');
    nodes.emojiById.set('default', '🔬');
    nodes.order.push(['default']);
    nodes.tabState.set('activeTabId', 'default');
  });
  writeText(doc, 'default', 'Talked to 5 users.');
  v7CreateTab(doc, 'Xk3fQ9a');
  writeText(doc, 'Xk3fQ9a', 'Ship in Q4.');
  v7CreateTab(doc, 'Lm8tR2p');
  writeText(doc, 'Lm8tR2p', 'Budget notes.');
  return doc;
};

export const existingDocFixtures: Record<string, () => string> = {
  'current doc with several tabs (schema 2)': () => encode(v2Doc()),

  'older doc (schema 1, no version marker)': () => {
    const doc = makeDoc(12);
    doc.transact(() => {
      const nodes = v7GetTabsYdocNodes(doc);
      nodes.nameById.set('default', 'Tab 1');
      nodes.emojiById.set('default', null);
      nodes.order.push(['default']);
    });
    writeText(doc, 'default', 'Old format text.');
    v7CreateTab(doc, 'q1W2e3r');
    writeText(doc, 'q1W2e3r', 'Second tab.');
    return encode(doc);
  },

  'doc with the old ddocTabs record': () => {
    const doc = makeDoc(13);
    doc.transact(() => {
      const legacy = doc.getMap('ddocTabs');
      const order = new Y.Array<string>();
      order.push(['default', 'legacyB']);
      const tabs = new Y.Map();
      const tabA = new Y.Map();
      tabA.set('name', 'Intro');
      tabA.set('emoji', null);
      const tabB = new Y.Map();
      tabB.set('name', 'Details');
      tabB.set('emoji', '📌');
      tabs.set('default', tabA);
      tabs.set('legacyB', tabB);
      const active = new Y.Text();
      active.insert(0, 'legacyB');
      legacy.set('order', order);
      legacy.set('tabs', tabs);
      legacy.set('activeTabId', active);
    });
    writeText(doc, 'default', 'Legacy intro.');
    writeText(doc, 'legacyB', 'Legacy details.');
    return encode(doc);
  },

  'single-tab doc with no tab records': () => {
    const doc = makeDoc(14);
    writeText(doc, 'default', 'Just one page.');
    return encode(doc);
  },

  'doc with deleted tabs': () => {
    const doc = v2Doc();
    v7DeleteTab(doc, 'Xk3fQ9a');
    return encode(doc);
  },

  'doc whose order has a duplicate and a missing id': () => {
    const doc = v2Doc();
    doc.transact(() => {
      const nodes = v7GetTabsYdocNodes(doc);
      nodes.order.push(['default']); // duplicate, as concurrent moves leave
      nodes.nameById.set('orphan1', 'Named but not in order');
      nodes.emojiById.set('orphan1', null);
    });
    writeText(doc, 'orphan1', 'Orphan text.');
    return encode(doc);
  },

  'doc made from a template (uuid ids)': () => {
    const doc = makeDoc(15);
    const ids = [
      'default',
      '7f9e2c1a-3b4d-4e5f-8a6b-9c0d1e2f3a4b',
      'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    ];
    doc.transact(() => {
      doc.getMap('ddocMeta').set('schemaVersion', 2);
      const nodes = v7GetTabsYdocNodes(doc);
      nodes.order.insert(0, ids);
      ['Chapter 1', 'Chapter 2', 'Notes'].forEach((name, i) => {
        nodes.nameById.set(ids[i], name);
        nodes.emojiById.set(ids[i], i === 0 ? '📖' : null);
      });
      nodes.tabState.set('activeTabId', ids[0]);
    }, 'self');
    ids.forEach((id, i) => writeText(doc, id, `Template body ${i}.`));
    return encode(doc);
  },

  'doc edited on two devices': () => {
    const a = v2Doc();
    const b = copyDoc(a, 16);
    v7CreateTab(b, 'fromB01');
    writeText(b, 'fromB01', 'Written on the phone.');
    writeText(a, 'default', 'Written on the laptop.');
    syncAll(a, b);
    return encode(a);
  },

  'large doc (150 tabs)': () => {
    const doc = v2Doc();
    for (let i = 0; i < 147; i++) {
      const id = `big${i}`;
      v7CreateTab(doc, id);
      writeText(doc, id, `Section ${i} `.repeat(40));
    }
    return encode(doc);
  },
};
