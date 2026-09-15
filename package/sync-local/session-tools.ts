import { toUint8Array } from 'js-base64';

import { SocketClient } from './socketClient';
import { crypto as cryptoUtils } from './crypto';
import { CollabConnectionConfig, ISocketInitConfig } from './types';

// The auth-identity subset SocketClient's constructor reads (mirrors SyncManager.connect,
// SyncManager.ts:233-286) — no roomInfo/editLock/title/rotation hooks, since these
// connections never register meta or awareness.
function buildSocketClientConfig(
  ownerAuth: CollabConnectionConfig,
  roomKey: string,
  roomId: string,
  joinOnly: boolean,
) {
  return {
    wsUrl: ownerAuth.wsUrl,
    roomKey,
    roomId,
    ownerEdSecret: ownerAuth.ownerEdSecret,
    contractAddress: ownerAuth.contractAddress,
    ownerAddress: ownerAuth.ownerAddress,
    identityToken: ownerAuth.identityToken,
    joinOnly,
  };
}

// Connects and waits for the handshake, rejecting on any failure — unlike SyncManager's
// joinOnly quiet-degrade (which resolves into a terminated state), these headless callers
// must throw so a partial hydrate/seed is never mistaken for success.
function connectAndAuth(client: SocketClient): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const config: ISocketInitConfig = {
      onHandshakeSuccess: () => settle(resolve),
      onDisconnect: () =>
        settle(() =>
          reject(
            new Error('session-tools: socket disconnected before handshake'),
          ),
        ),
      onSocketDropped: () => {},
      onHandShakeError: (e) => settle(() => reject(e)),
      onContentUpdate: () => {},
      onMembershipChange: () => {},
      onSessionTerminated: () => {},
      onReconnectFailed: () =>
        settle(() =>
          reject(
            new Error(
              'session-tools: failed to connect to collaboration server',
            ),
          ),
        ),
      onError: (e) => settle(() => reject(e)),
    };

    client.connectSocket(config)?.catch(() => {
      /* handled via the callbacks above */
    });
  });
}

/**
 * Headless hydrate: pulls the OLD session's durable log and decrypts it with `roomKey`.
 * The old session still exists server-side — termination only rejects writes, so a
 * joinOnly read succeeds even after cutover. Mirrors the connect-time hydration pull
 * (SyncManager.catchUpFloor / decodeInto), minus the Y.Doc/floor bookkeeping. Throws on
 * connect/auth/pull failure; an individual undecryptable row is skipped, not fatal.
 */
export async function fetchSessionState(args: {
  ddocId: string;
  roomKey: string;
  ownerAuth: CollabConnectionConfig;
}): Promise<Uint8Array[]> {
  const client = new SocketClient(
    buildSocketClientConfig(args.ownerAuth, args.roomKey, args.ddocId, true),
  );
  try {
    await connectAndAuth(client);

    const roomKeyBytes = toUint8Array(args.roomKey);
    const updates: Uint8Array[] = [];
    let sinceSeq: number | undefined;

    for (;;) {
      const res = await client.fetchHydrationRange(sinceSeq);
      if (!res?.status || !res.data) {
        throw new Error(res?.error || 'fetchSessionState: history pull failed');
      }

      for (const row of res.data.history) {
        try {
          updates.push(cryptoUtils.decryptData(roomKeyBytes, row.data));
        } catch {
          // Undecryptable row (poison/rotation noise) — skip, exactly like decodeInto.
        }
      }

      if (res.data.hasMore && typeof res.data.nextSeq === 'number') {
        sinceSeq = res.data.nextSeq;
        continue;
      }
      return updates;
    }
  } finally {
    client.disconnect();
  }
}

/**
 * Headless seed: pushes `state` into a brand-new session as a single owner snapshot,
 * encrypted under `newRoomKey`. `floorSeq: 0` — the target session is freshly created by
 * the rotate op and holds no rows yet, so there is nothing to catch up before stamping.
 *
 * Caller ordering: must run AFTER the rotate op has already created the target session.
 * This function's own owner `/auth` is create-or-join — calling it first would create the
 * target session itself and, as an owner /auth, sweep (terminate) any other non-terminated
 * session for this document, which is the OLD session that's supposed to keep draining
 * stragglers during the rotation window. Seeding early collapses that drain early.
 */
export async function seedSession(args: {
  ddocId: string;
  newRoomKey: string;
  state: Uint8Array;
  ownerAuth: CollabConnectionConfig;
}): Promise<void> {
  const client = new SocketClient(
    buildSocketClientConfig(
      args.ownerAuth,
      args.newRoomKey,
      args.ddocId,
      false,
    ),
  );
  try {
    await connectAndAuth(client);

    const data = cryptoUtils.encryptData(
      toUint8Array(args.newRoomKey),
      args.state,
      client.getWireFormat(),
    );
    const res = await client.sendSnapshot({ data, floorSeq: 0 });
    if (!res?.status) {
      throw new Error(res?.error || 'seedSession: snapshot push failed');
    }
  } finally {
    client.disconnect();
  }
}
