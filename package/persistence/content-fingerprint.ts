import { fromUint8Array } from 'js-base64';
import * as Y from 'yjs';
import {
  ACTIVE_TAB_STATE_KEY,
  STATE_ROOT_KEY,
} from '../components/tabs/utils/tab-utils';

type ClockRange = [start: number, end: number];

/**
 * Join ranges that touch. Input is sorted by start, as the store keeps it.
 * Lossless: the result covers exactly the same clocks, written one way, so
 * the description does not depend on how Yjs split or joined items.
 */
export const mergeRanges = (ranges: ClockRange[]): ClockRange[] => {
  const merged: ClockRange[] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && last[1] === start) {
      last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
};

const formatRanges = (ranges: ClockRange[]) =>
  ranges.map(([start, end]) => `${start}-${end}`).join(',');

/**
 * A canonical description of a doc's content: for every writer, which clock
 * ranges it inserted and which of those are deleted, leaving out the
 * active-tab pointer.
 *
 * Every content edit (text, formatting, a tab rename or reorder, any root a
 * later package version adds) inserts or deletes a struct, so it changes this.
 * The active tab is per-user UI state written with the `'self'` origin
 * (use-tab-manager.ts) and is skipped, so a tab switch does not. The rule
 * lists what to skip rather than what to include, so a mistake can only make
 * an unchanged doc look changed, never hide an edit.
 *
 * Ranges are merged so the result does not depend on how Yjs split or joined
 * items: the same state gives the same description however it was produced.
 */
export const describeDdocContent = (doc: Y.Doc): string => {
  const tabState = doc.share.get(STATE_ROOT_KEY);
  const isActiveTabPointer = (struct: Y.Item | unknown) =>
    tabState !== undefined &&
    struct instanceof Y.Item &&
    struct.parent === tabState &&
    struct.parentSub === ACTIVE_TAB_STATE_KEY;

  const clients = Array.from(doc.store.clients.keys()).sort((a, b) => a - b);
  const parts: string[] = [];
  for (const client of clients) {
    const present: ClockRange[] = [];
    const deleted: ClockRange[] = [];
    for (const struct of doc.store.clients.get(client) ?? []) {
      if (isActiveTabPointer(struct)) continue;
      const range: ClockRange = [
        struct.id.clock,
        struct.id.clock + struct.length,
      ];
      present.push(range);
      if (struct.deleted) deleted.push([...range]);
    }
    if (present.length === 0) continue;
    parts.push(
      `${client}:${formatRanges(mergeRanges(present))}|${formatRanges(
        mergeRanges(deleted),
      )}`,
    );
  }
  return parts.join(';');
};

/** SHA-256 of `describeDdocContent`, base64 (44 characters). */
export const fingerprintDdocContent = async (doc: Y.Doc): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(describeDdocContent(doc)),
  );
  return fromUint8Array(new Uint8Array(digest));
};
