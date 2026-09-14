import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  advanceFloor,
  computeLocalOnlyUpdate,
  floorEligibleSeqs,
  shouldAuthorSnapshot,
} from './floor';

const stateOf = (doc: Y.Doc) => Y.encodeStateAsUpdate(doc);

describe('computeLocalOnlyUpdate', () => {
  it('returns null for a structurally empty local doc', () => {
    expect(computeLocalOnlyUpdate(new Y.Doc(), null)).toBeNull();
    const server = new Y.Doc();
    server.getMap('m').set('a', 1);
    expect(computeLocalOnlyUpdate(new Y.Doc(), stateOf(server))).toBeNull();
  });

  it('returns the full state when the server log is empty (seed)', () => {
    const local = new Y.Doc();
    local.getMap('m').set('a', 1);
    const seed = computeLocalOnlyUpdate(local, null);
    expect(seed).not.toBeNull();
    const replay = new Y.Doc();
    Y.applyUpdate(replay, seed!);
    expect(replay.getMap('m').get('a')).toBe(1);
  });

  it('returns null when local content is exactly the hydrated server content', () => {
    const origin = new Y.Doc();
    origin.getMap('m').set('a', 1);
    origin.getMap('m').set('b', 2);
    origin.getMap('m').delete('a'); // server content includes deletes
    const serverMerged = stateOf(origin);

    const local = new Y.Doc();
    Y.applyUpdate(local, serverMerged); // the hydration walk
    expect(computeLocalOnlyUpdate(local, serverMerged)).toBeNull();
  });

  it('returns only the local-only ops, and applying them to the log converges', () => {
    const origin = new Y.Doc();
    origin.getMap('m').set('a', 1);
    const serverMerged = stateOf(origin);

    const local = new Y.Doc();
    Y.applyUpdate(local, serverMerged);
    local.getMap('m').set('offline', 'edit'); // e.g. IndexedDB content minted pre-connect

    const diff = computeLocalOnlyUpdate(local, serverMerged);
    expect(diff).not.toBeNull();
    // Far smaller than a full-state rebroadcast.
    expect(diff!.length).toBeLessThan(stateOf(local).length);

    const serverView = new Y.Doc();
    Y.applyUpdate(serverView, serverMerged);
    Y.applyUpdate(serverView, diff!);
    expect(serverView.getMap('m').get('offline')).toBe('edit');
    expect(serverView.getMap('m').get('a')).toBe(1);
  });

  it('carries a local-only DELETE (deletions must never be dropped)', () => {
    const origin = new Y.Doc();
    origin.getMap('m').set('a', 1);
    const serverMerged = stateOf(origin);

    const local = new Y.Doc();
    Y.applyUpdate(local, serverMerged);
    local.getMap('m').delete('a'); // offline deletion the log has never seen

    const diff = computeLocalOnlyUpdate(local, serverMerged);
    expect(diff).not.toBeNull();

    const serverView = new Y.Doc();
    Y.applyUpdate(serverView, serverMerged);
    Y.applyUpdate(serverView, diff!);
    expect(serverView.getMap('m').has('a')).toBe(false);
  });

  it('treats a multi-page merge (snapshot + tail rows) as one server state', () => {
    const origin = new Y.Doc();
    origin.getMap('m').set('a', 1);
    const snapshot = stateOf(origin);
    const sv = Y.encodeStateVector(origin);
    origin.getMap('m').set('b', 2);
    const tailRow = Y.encodeStateAsUpdate(origin, sv);
    const serverMerged = Y.mergeUpdates([snapshot, tailRow]);

    const local = new Y.Doc();
    Y.applyUpdate(local, serverMerged);
    expect(computeLocalOnlyUpdate(local, serverMerged)).toBeNull();
  });
});

describe('advanceFloor', () => {
  it('advances to the highest seq seen, ignoring lower ones', () => {
    expect(advanceFloor(5, [3, 7, 6])).toBe(7);
    expect(advanceFloor(9, [3, 7])).toBe(9);
    expect(advanceFloor(0, [])).toBe(0);
  });
});

describe('shouldAuthorSnapshot', () => {
  it('requires authorship rights and the threshold', () => {
    expect(
      shouldAuthorSnapshot({
        canAuthor: true,
        updatesSinceLastSnapshot: 100,
        threshold: 100,
      }),
    ).toBe(true);
    expect(
      shouldAuthorSnapshot({
        canAuthor: false,
        updatesSinceLastSnapshot: 100,
        threshold: 100,
      }),
    ).toBe(false);
    expect(
      shouldAuthorSnapshot({
        canAuthor: true,
        updatesSinceLastSnapshot: 99,
        threshold: 100,
      }),
    ).toBe(false);
  });
});

describe('floorEligibleSeqs', () => {
  const ok = (seq: number) => ({ seq, isTail: true, decrypted: true });
  const miss = (seq: number) => ({ seq, isTail: true, decrypted: false });
  const snapshot = (decrypted: boolean) => ({
    seq: null,
    isTail: false,
    decrypted,
  });

  it('returns every tail seq when everything decrypts', () => {
    const r = floorEligibleSeqs([snapshot(true), ok(3), ok(4), ok(6)], false);
    expect(r).toEqual({ seqs: [3, 4, 6], incomplete: false });
  });

  it('pins the floor below the first miss and flags incomplete', () => {
    const r = floorEligibleSeqs([ok(3), ok(4), miss(5), ok(6)], false);
    expect(r).toEqual({ seqs: [3, 4], incomplete: true });
  });

  it('stays pinned on later pages once incomplete', () => {
    const r = floorEligibleSeqs([ok(9), ok(10)], true);
    expect(r).toEqual({ seqs: [], incomplete: true });
  });

  it('a snapshot miss pins everything on that page', () => {
    const r = floorEligibleSeqs([snapshot(false), ok(3), ok(4)], false);
    expect(r).toEqual({ seqs: [], incomplete: true });
  });

  it('a decrypted snapshot contributes no seq of its own', () => {
    const r = floorEligibleSeqs([snapshot(true)], false);
    expect(r).toEqual({ seqs: [], incomplete: false });
  });
});
