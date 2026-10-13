import * as Y from 'yjs';
import {
  DEFAULT_TAB_ID,
  LEGACY_ROOT_KEY,
  ORDER_ROOT_KEY,
} from '../components/tabs/utils/tab-utils';

export const DDOC_META_ROOT_KEY = 'ddocMeta';
export const SCHEMA_VERSION_META_KEY = 'schemaVersion';

// The highest doc schema this build can safely open for editing.
// 1 = dBlock wrapper, 2 = flat (wrapper-less) blocks.
export const SUPPORTED_SCHEMA_VERSION = 2;

// Docs created before the marker existed have no ddocMeta entry: treat as v1.
export const getDocSchemaVersion = (doc: Y.Doc): number => {
  const version = doc.getMap(DDOC_META_ROOT_KEY).get(SCHEMA_VERSION_META_KEY);
  return typeof version === 'number' ? version : 1;
};

export const isDocSchemaSupported = (doc: Y.Doc): boolean =>
  getDocSchemaVersion(doc) <= SUPPORTED_SCHEMA_VERSION;

// Body fragments are keyed by tab id (tab-utils applyResolvedTabState), so
// the tab order lists them; pre-tabs docs hold their body under the default
// id. Only these keys are instantiated as fragments: typing an unknown root
// by guess would break a later getMap/getArray on the same key.
const getTabFragmentIds = (doc: Y.Doc): string[] => {
  const ids = new Set<string>([DEFAULT_TAB_ID]);
  const addAll = (values: unknown[]) => {
    values.forEach((value) => {
      if (typeof value === 'string') ids.add(value);
    });
  };
  addAll(doc.getArray<string>(ORDER_ROOT_KEY).toArray());
  const legacyOrder = doc.getMap(LEGACY_ROOT_KEY).get('order');
  if (legacyOrder instanceof Y.Array) addAll(legacyOrder.toArray());
  return Array.from(ids);
};

// True when any tab body holds at least one block. A doc that only carries
// tab metadata (the seeded default tab of a brand-new doc) is still empty.
export const docHasBlockContent = (doc: Y.Doc): boolean =>
  getTabFragmentIds(doc).some((id) => doc.getXmlFragment(id).length > 0);

// v1 wraps every top-level block in a dBlock; v2 content never contains one.
// Top-level children only: that is where v1 puts the wrapper, and it keeps
// the walk O(blocks) on large docs.
export const docHasV1Blocks = (doc: Y.Doc): boolean =>
  getTabFragmentIds(doc).some((id) => {
    const fragment = doc.getXmlFragment(id);
    for (let index = 0; index < fragment.length; index += 1) {
      const child = fragment.get(index);
      if (child instanceof Y.XmlElement && child.nodeName === 'dBlock') {
        return true;
      }
    }
    return false;
  });
