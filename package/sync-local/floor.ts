import * as Y from 'yjs';

// The authorship floor is the highest seq the client has applied as an ordered
// range read. A range read returns a gapless PREFIX of the update rows above the
// cursor (snapshot rows consume seqs but are excluded from the tail, so
// non-consecutive integers are expected and are NOT a gap). Live broadcasts carry
// no seq and never reach this function, so they never advance the floor — which is
// exactly what keeps an owner-authored snapshot's floorSeq honest.
export function advanceFloor(
  floor: number,
  pageSeqsAscending: number[],
): number {
  let next = floor;
  for (const seq of pageSeqsAscending) {
    if (seq > next) next = seq;
  }
  return next;
}

// Snapshot cadence for any writer (the server admits owners and admitted editors; a
// joinOnly client passes canAuthor=false). The floor is advanced by a catch-up read
// inside the authoring routine, so it is not a precondition here.
export function shouldAuthorSnapshot(p: {
  canAuthor: boolean;
  updatesSinceLastSnapshot: number;
  threshold: number;
}): boolean {
  return p.canAuthor && p.updatesSinceLastSnapshot >= p.threshold;
}

// The update carrying ops/deletes the local doc holds that the server's log provably
// lacks, or null when there is nothing local-only worth writing. `serverMerged` is the
// merged decrypted log content from a full hydration walk; null means an empty log,
// where the whole local state is the seed. Sending a diff instead of the full state is
// what keeps the durable log from growing by one document copy per join.
export function computeLocalOnlyUpdate(
  ydoc: Y.Doc,
  serverMerged: Uint8Array | null,
): Uint8Array | null {
  const full = Y.encodeStateAsUpdate(ydoc);
  if (full.length <= 2) return null; // structurally empty doc
  if (serverMerged === null) return full; // empty log — seed it
  const serverSV = Y.encodeStateVectorFromUpdate(serverMerged);
  const diff = Y.encodeStateAsUpdate(ydoc, serverSV);
  // encodeStateAsUpdate always carries the doc's full delete set even when no structs
  // are missing. The log's diff against its own state vector is exactly that redundant
  // baseline — a byte-identical result means nothing local-only exists, deletes included.
  const baseline = Y.diffUpdate(serverMerged, serverSV);
  if (
    diff.length === baseline.length &&
    diff.every((b, i) => b === baseline[i])
  ) {
    return null;
  }
  return diff;
}

// Seqs that may advance the floor from one hydration page. A row that failed to decrypt
// pins the floor below it for the rest of the walk, so a later snapshot can never stamp a
// floorSeq above content this client never applied.
export function floorEligibleSeqs(
  rows: Array<{ seq: number | null; isTail: boolean; decrypted: boolean }>,
  alreadyIncomplete: boolean,
): { seqs: number[]; incomplete: boolean } {
  const seqs: number[] = [];
  let incomplete = alreadyIncomplete;
  for (const row of rows) {
    if (!row.decrypted) incomplete = true;
    if (incomplete) continue;
    if (row.isTail && typeof row.seq === 'number') seqs.push(row.seq);
  }
  return { seqs, incomplete };
}
