/* eslint-disable @typescript-eslint/no-explicit-any */
import { io, Socket } from 'socket.io-client';
import * as ucans from '@ucans/ucans';

import {
  ISocketInitConfig,
  SocketStatusEnum,
  SendUpdateResponse,
  HydrationResponse,
  SnapshotResponse,
  IAuthArgs,
  AckResponse,
} from './types';
import {
  assignSessionColors,
  buildIdentityMap,
  identitySignature,
  mergePresence,
} from './presence';
import { IDocCollabUsers } from '../types';
import { generateKeyPairFromSeed } from '@stablelib/ed25519';
import { fromUint8Array, toUint8Array } from 'js-base64';
import { crypto } from './crypto';
import {
  Awareness,
  applyAwarenessUpdate,
  removeAwarenessStates,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness.js';

interface ISocketClientConfig {
  wsUrl: string;
  roomKey: string;
  roomId: string;
  ownerEdSecret?: string;
  contractAddress?: string;
  ownerAddress?: string;
  editLock?: string;
  encryptedTitle?: string;
  identityToken?: string;
  editUcan?: string;
  refreshEditClaim?: () => Promise<
    | { status: 'ok'; token: string }
    | { status: 'demoted' }
    | { status: 'unavailable' }
  >;
  // Config-shape parity with refreshEditClaim; not yet stored on the instance — the
  // rekey() path (Task 3) is the first consumer.
  onRotationPrepare?: (inner: {
    epoch: number;
    gp: string;
    appLock?: string;
  }) => Promise<string | { roomKey: string; editUcan?: string } | null>;
  // Rotation PREPARE/cutover signals — SyncManager sets these.
  onEpochAvailable?: (data: {
    roomId: string;
    epoch: number;
    payload: string;
  }) => void | Promise<void>;
  onCutover?: (data: { roomId: string; epoch: number }) => void | Promise<void>;
  actorHandle?: string;
  joinOnly?: boolean;
  onHandshakeData?: (response: { data: AckResponse; roomKey: string }) => void;
  roomInfo?: {
    documentTitle: string;
    portalAddress: string;
    commentKey: string;
  };
}
export class SocketClient {
  private _socketUrl: string;
  private _restBase: string;
  private _lastSessionToken: string | null = null;
  private _socket: Socket | null = null;
  private _webSocketStatus: SocketStatusEnum = SocketStatusEnum.CLOSED;
  private _isIntentionalDisconnect = false;

  get isConnected(): boolean {
    return this._webSocketStatus === SocketStatusEnum.CONNECTED;
  }

  get status(): SocketStatusEnum {
    return this._webSocketStatus;
  }
  private _websocketServiceDid = '';
  private roomId = '';

  roomMembers: string[] = [];
  private _lastPresenceSignature = '';
  private _presenceColorByName = new Map<string, string>();
  private _onPresenceChange?: (collaborators: IDocCollabUsers[]) => void;
  private _pendingAwarenessUpdates: { data: any; roomId: string }[] = [];
  private collaborationKeyPair: ucans.EdKeypair | null = null;
  private ownerKeyPair?: ucans.EdKeypair;
  private contractAddress?: string;
  private ownerUcan?: ucans.Ucan;
  private collaborationUcan?: ucans.Ucan;
  private ownerAddress?: string;
  private editLock?: string;
  private encryptedTitle?: string;
  private identityToken?: string;
  private editUcan?: string;
  private refreshEditClaim?: () => Promise<
    | { status: 'ok'; token: string }
    | { status: 'demoted' }
    | { status: 'unavailable' }
  >;
  private lastGoodEditUcan?: string;
  private actorHandle?: string;
  private joinOnly?: boolean;
  private roomKey: string;
  private roomInfo?: {
    documentTitle: string;
    portalAddress: string;
    commentKey: string;
  };
  private awareness: Awareness | null = null;
  private connectionAttemptErrorCount = 0;

  private _onHandshakeData: ISocketClientConfig['onHandshakeData'] | null =
    null;
  private _onEpochAvailable: ISocketClientConfig['onEpochAvailable'] | null =
    null;
  private _onCutover: ISocketClientConfig['onCutover'] | null = null;
  // True while an in-place rekey's re-auth is in flight — the outgoing session's
  // leave can trigger '/session/terminated' on this same socket; swallow it so a
  // rotation isn't surfaced as a kick.
  private _rotating = false;

  constructor(config: ISocketClientConfig) {
    this._socketUrl = config.wsUrl || 'ws://localhost:5000';
    // REST endpoints (e.g. /flush) share the collab-server origin; normalize ws→http.
    this._restBase = (config.wsUrl || 'http://localhost:5000')
      .replace(/^ws(s?):\/\//, 'http$1://')
      .replace(/\/+$/, '');
    const { secretKey: ucanSecret } = generateKeyPairFromSeed(
      toUint8Array(config.roomKey),
    );

    this.roomKey = config.roomKey;
    this.roomId = config.roomId;

    this.collaborationKeyPair = ucans.EdKeypair.fromSecretKey(
      fromUint8Array(ucanSecret),
    );

    if (config.ownerEdSecret)
      this.ownerKeyPair = ucans.EdKeypair.fromSecretKey(config.ownerEdSecret);

    if (config.contractAddress) this.contractAddress = config.contractAddress;
    if (config.ownerAddress) this.ownerAddress = config.ownerAddress;
    if (config.editLock) this.editLock = config.editLock;
    if (config.identityToken) this.identityToken = config.identityToken;
    if (config.editUcan) this.editUcan = config.editUcan;
    this.lastGoodEditUcan = config.editUcan;
    if (config.refreshEditClaim)
      this.refreshEditClaim = config.refreshEditClaim;
    if (config.actorHandle) this.actorHandle = config.actorHandle;
    if (config.joinOnly) this.joinOnly = config.joinOnly;
    if (config.encryptedTitle) this.encryptedTitle = config.encryptedTitle;
    if (config.onHandshakeData) this._onHandshakeData = config.onHandshakeData;
    if (config.onEpochAvailable)
      this._onEpochAvailable = config.onEpochAvailable;
    if (config.onCutover) this._onCutover = config.onCutover;
    if (config.roomInfo) this.roomInfo = config.roomInfo;
  }

  registerAwareness(awareness: Awareness) {
    if (this.awareness) this.awareness.off('update', this._recomputePresence);
    this.awareness = awareness;
    awareness.on('update', this._recomputePresence);
    // Awareness is created at 'ready', after the handshake already tried (and
    // skipped) the stamp — without this, first-connect states never carry a
    // socketId and the whole roster renders as placeholders.
    this._stampSocketId();
    const pending = this._pendingAwarenessUpdates;
    this._pendingAwarenessUpdates = [];
    pending.forEach((d) => this._handleAwarenessUpdate(d));
  }

  // Invariant: whenever both an awareness and a live socket exist, the local
  // 'socketId' awareness field matches socket.id. Re-stamping the same value
  // still bumps the awareness clock, re-broadcasting the full local state.
  private _stampSocketId() {
    if (this.awareness && this._socket?.id) {
      this.awareness.setLocalStateField('socketId', this._socket.id);
    }
  }

  private _emitWithAck<T = any>(
    event: string,
    args: any,
    timeoutMs = 15000,
  ): Promise<AckResponse<T>> {
    return new Promise((resolve, reject) => {
      if (
        (this._webSocketStatus !== SocketStatusEnum.CONNECTED &&
          this._webSocketStatus !== SocketStatusEnum.CONNECTING) ||
        !this._socket
      ) {
        const error = new Error('Lost connection to websocket server');
        error.name = 'SocketConnectionLostError';
        reject(error);
        return;
      }

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        const error = new Error(
          `Socket emit "${event}" timed out after ${timeoutMs}ms`,
        );
        error.name = 'SocketTimeoutError';
        reject(error);
      }, timeoutMs);

      this._socket.emit(event, args, (response: AckResponse<T>) => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve(response);
      });
    });
  }

  private async _fetchRoomMembers() {
    const data = await this._emitWithAck<{ peers: string[] }>(
      '/documents/peers/list',
      { documentId: this.roomId },
    );

    if (!data || !data.status) {
      throw new Error('Failed to fetch room members');
    }

    this.roomMembers = data.data?.peers ?? [];
  }

  private _recomputePresence = () => {
    // Guarded to connected: the disconnect-time awareness cleanup fires an awareness
    // update; skipping while disconnected keeps live peers from flashing to placeholders
    // until reconnect refetches the roster.
    if (!this.isConnected || !this.awareness || !this._onPresenceChange) return;
    const identity = buildIdentityMap(this.awareness.getStates());
    const sig = identitySignature(this.roomMembers, identity);
    if (sig === this._lastPresenceSignature) return;
    this._lastPresenceSignature = sig;

    const collaborators = assignSessionColors(
      mergePresence(this.roomMembers, identity),
      this._presenceColorByName,
    );
    const localUser = this.awareness.getLocalState()?.user;
    const localName = this._socket?.id
      ? identity.get(this._socket.id)?.name
      : undefined;
    const localColor = localName
      ? this._presenceColorByName.get(localName)
      : undefined;
    if (localUser && localColor && localUser.color !== localColor) {
      this.awareness.setLocalStateField('user', {
        ...localUser,
        color: localColor,
      });
    }
    this._onPresenceChange(collaborators);
  };

  public async sendUpdate({ update }: { update: string }) {
    const args = {
      data: update,
      documentId: this.roomId,
      collaborationToken: await this.buildSessionToken(),
    };

    return (await this._emitWithAck(
      '/documents/update',
      args,
    )) as SendUpdateResponse;
  }

  async fetchHydrationRange(sinceSeq?: number) {
    const args = { documentId: this.roomId, sinceSeq };
    return (await this._emitWithAck(
      '/documents/update/history',
      args,
    )) as HydrationResponse;
  }

  async sendSnapshot({
    data,
    floorSeq,
    publishedMarker,
  }: {
    data: string;
    floorSeq: number;
    publishedMarker?: string | null;
  }) {
    const args = {
      data,
      floorSeq,
      publishedMarker: publishedMarker ?? null,
      documentId: this.roomId,
      collaborationToken: await this.buildSessionToken(),
    };
    return (await this._emitWithAck(
      '/documents/snapshot',
      args,
    )) as SnapshotResponse;
  }

  async sendMirrorSnapshot({
    data,
    fileKeyEpoch,
  }: {
    data: string;
    fileKeyEpoch: number;
  }) {
    const args = {
      data,
      fileKeyEpoch,
      documentId: this.roomId,
    };
    return await this._emitWithAck('/documents/mirror-snapshot', args);
  }

  async setDocumentMeta(): Promise<void> {
    if (!this.editLock && !this.encryptedTitle) return;
    await this._emitWithAck('/documents/meta', {
      documentId: this.roomId,
      editLock: this.editLock ?? null,
      title: this.encryptedTitle ?? null,
    });
  }

  /** Owner rename mid-session: refresh the connect-frozen title artifacts (so
   *  every later /auth re-sends current values), persist server-side, and let
   *  the server broadcast /document/meta_update to room peers. */
  async updateDocumentMeta(args: {
    encryptedTitle: string;
    documentTitle: string;
  }): Promise<void> {
    this.encryptedTitle = args.encryptedTitle;
    if (this.roomInfo) this.roomInfo.documentTitle = args.documentTitle;
    if (this._webSocketStatus !== SocketStatusEnum.CONNECTED) return;
    await this._emitWithAck('/documents/meta', {
      documentId: this.roomId,
      editLock: this.editLock ?? null,
      title: args.encryptedTitle,
    });
  }

  public async broadcastAwareness(awarenessUpdate: string) {
    if (this._webSocketStatus !== SocketStatusEnum.CONNECTED || !this._socket)
      return;
    const args = {
      documentId: this.roomId,
      data: {
        position: awarenessUpdate,
      },
    };
    this._socket.emit('/documents/awareness', args);
  }

  public disconnect = () => {
    this._isIntentionalDisconnect = true;
    this._webSocketStatus = SocketStatusEnum.CLOSED;
    this._pendingAwarenessUpdates = [];
    if (!this._socket) return;
    this._socket.disconnect();
    this._socket = null;
    this._webSocketStatus = SocketStatusEnum.CLOSED;
  };

  // Re-establishes the connection so '/server/handshake' → '/auth' re-runs (re-minting the
  // editUcan via refreshEditClaim), without tearing down editor/SyncManager state.
  public reauth = () => {
    if (!this._socket) return;
    // Live socket (soft revocation): the server won't re-emit '/server/handshake' on a still-open
    // connection, so bounce it — disconnect().connect() forces a fresh handshake + editUcan re-mint.
    // Already-dropped socket (server force-drop / reconnecting): just reopen.
    if (this._socket.connected) {
      this._socket.disconnect().connect();
    } else {
      this._socket.connect();
    }
  };

  // In-place roomKey migration: re-derive the collab keypair and re-/auth the SAME socket
  // into sessionDid_{e+1} — no disconnect, no reconnect blink. Reverts all key material on
  // failure so the caller's self-heal path can retry from a coherent old-key state.
  async rekey(
    newRoomKey: string,
    newAppLock?: string,
    newEditUcan?: string,
  ): Promise<void> {
    this._rotating = true;
    const prevRoomKey = this.roomKey;
    const prevEditLock = this.editLock;
    try {
      // The new-epoch editUcan minted by the SAME gate release that resolved newRoomKey.
      // Install it as the last-good claim BEFORE re-auth: refreshEditClaim can race the
      // rotation's deferred publish and come back 'unavailable' (or with a stale-epoch
      // token), and the fallback must then present THIS claim, not the pre-rotation one.
      // Deliberately not reverted on failure — the epoch floor is monotonic, so a newer
      // claim is never worse, and the self-heal retry path (which passes no editUcan)
      // relies on it staying installed.
      if (newEditUcan) this.lastGoodEditUcan = newEditUcan;
      this.roomKey = newRoomKey;
      // Same two-step derivation the constructor uses — the keypair is a ucans.EdKeypair,
      // not the raw generateKeyPairFromSeed result.
      const { secretKey } = generateKeyPairFromSeed(toUint8Array(newRoomKey));
      this.collaborationKeyPair = ucans.EdKeypair.fromSecretKey(
        fromUint8Array(secretKey),
      );
      // The cached session UCAN was issued by the old keypair and is still time-valid —
      // invalidate it so buildSessionToken mints a fresh one under the new keypair instead
      // of handing the server a token whose issuer no longer matches sessionDid.
      this.collaborationUcan = undefined;
      // editLock is the appLock collab config, encrypted under the WORKSPACE key — NOT the
      // roomKey — so it can't be re-keyed here; the rotation relay carries the freshly
      // re-locked value (inner.appLock), so adopt that when present. The title is AES-GCM
      // under the roomKey and stays as-is: it is display-only and the owner re-broadcasts it
      // on the next rename. See docs/architecture/gp-semaphore.md.
      if (newAppLock !== undefined) this.editLock = newAppLock;

      const response = await this._authenticate({ rotationCutover: true });
      if (response.statusCode !== 200) {
        throw new Error(
          (response?.error || 'Unknown error') +
            `, statusCode: ${response?.statusCode}`,
        );
      }
      // Mirrors _handleHandShake's success path. No-op for the steady-state cutover caller
      // (already CONNECTED); needed when rekey heals a socket whose first /auth never
      // completed (terminated-JOIN self-heal).
      this._webSocketStatus = SocketStatusEnum.CONNECTED;
    } catch (e) {
      // Failed re-auth: revert so the old key/session stay coherent; the caller's heal
      // path retries from scratch.
      this.roomKey = prevRoomKey;
      const { secretKey } = generateKeyPairFromSeed(toUint8Array(prevRoomKey));
      this.collaborationKeyPair = ucans.EdKeypair.fromSecretKey(
        fromUint8Array(secretKey),
      );
      this.collaborationUcan = undefined;
      this.editLock = prevEditLock;
      throw e;
    } finally {
      this._rotating = false;
    }
  }

  async ackEpochLoaded(documentId: string, epoch: number): Promise<void> {
    await this._emitWithAck('/session/epoch_loaded', { documentId, epoch });
  }

  public terminateSession = async () => {
    try {
      const ownerToken = await this.getOwnerToken();
      const args = {
        documentId: this.roomId,
        ownerToken,
        ownerAddress: this.ownerAddress,
        contractAddress: this.contractAddress,
        sessionDid: this.collaborationKeyPair?.did(),
      };
      await this._emitWithAck('/documents/terminate', args);
    } finally {
      this.disconnect();
    }
  };

  // Fired from pagehide: a keepalive POST of the final merged delta so the last edits
  // survive a hard tab-close. Must run without an awaited token build, so it uses the
  // last session token minted during normal operation; if none exists, it no-ops.
  flushBeacon(mergedUpdate: string): void {
    const token = this._lastSessionToken;
    const sessionDid = this.collaborationKeyPair?.did();
    if (!token || !sessionDid || !mergedUpdate) return;

    // Carry the freshest known-good edit claim (same value threaded to /auth) so the server can
    // re-run offline admission on this durable-write path — H3(a) belt. Cached, no await: pagehide
    // can't refresh a token. Public/workspace rails hold no claim, so this stays undefined there.
    const editUcan = this.lastGoodEditUcan ?? this.editUcan;

    const url = `${this._restBase}/flush`;
    const body = JSON.stringify({
      documentId: this.roomId,
      sessionDid,
      collaborationToken: token,
      data: mergedUpdate,
      ...(editUcan ? { editUcan } : {}),
    });

    const sent =
      typeof navigator !== 'undefined' &&
      typeof navigator.sendBeacon === 'function' &&
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));

    if (!sent && typeof fetch === 'function') {
      void fetch(url, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
        keepalive: true,
      }).catch(() => {
        /* best-effort: local IndexedDB still holds this state */
      });
    }
  }

  private getCollaborationKeyPair() {
    if (!this.collaborationKeyPair)
      throw new Error('No collaboration key pair');
    return this.collaborationKeyPair;
  }

  private isUcanValid(ucan: ucans.Ucan) {
    const payload = ucan.payload;
    const now = Math.floor(Date.now() / 1000);
    const bufferSeconds = 60;

    return (
      (!payload.nbf || payload.nbf <= now) &&
      (!payload.exp || payload.exp > now + bufferSeconds)
    );
  }

  private async getOwnerToken() {
    if (!this.ownerKeyPair || !this.contractAddress)
      throw new Error('SocketClient: No owner key pair or contract address');

    if (this.ownerUcan && this.isUcanValid(this.ownerUcan)) {
      return ucans.encode(this.ownerUcan);
    }

    this.ownerUcan = await ucans.build({
      audience: this._websocketServiceDid,
      issuer: this.ownerKeyPair,
      lifetimeInSeconds: 3600, // 1 Hour
      notBefore: Math.floor(Date.now() / 1000) - 60,
      capabilities: [
        {
          with: {
            scheme: 'storage',
            hierPart: this.contractAddress.toLowerCase(),
          },
          can: { namespace: 'collaboration', segments: ['CREATE'] },
        },
      ],
    });

    return ucans.encode(this.ownerUcan);
  }

  private buildSessionToken = async () => {
    if (!this._websocketServiceDid) {
      throw new Error(
        'SocketClient: Server did not response with the server DID',
      );
    }
    if (this.collaborationUcan && this.isUcanValid(this.collaborationUcan)) {
      this._lastSessionToken = ucans.encode(this.collaborationUcan);
      return this._lastSessionToken;
    }
    const keyPair = this.getCollaborationKeyPair();

    this.collaborationUcan = await ucans.build({
      audience: this._websocketServiceDid,
      issuer: keyPair,
      lifetimeInSeconds: 3600, // 1 Hour
      notBefore: Math.floor(Date.now() / 1000) - 60,
      capabilities: [
        {
          with: {
            scheme: 'storage',
            hierPart: this.roomId,
          },
          can: { namespace: 'collaboration', segments: ['COLLABORATE'] },
        },
      ],
    });

    this._lastSessionToken = ucans.encode(this.collaborationUcan);
    return this._lastSessionToken;
  };

  // Builds the /auth args and emits, shared by the initial handshake and rekey's in-place
  // re-auth (rotationCutover: true) on an already-connected socket.
  private _authenticate = async (opts?: {
    rotationCutover?: boolean;
  }): Promise<AckResponse> => {
    const token = await this.buildSessionToken();
    const args: IAuthArgs & { rotationCutover?: boolean } = {
      collaborationToken: token,
      sessionDid: this.collaborationKeyPair?.did(),
      documentId: this.roomId,
    };

    if (this.roomInfo)
      args.roomInfo = crypto.encryptData(
        toUint8Array(this.roomKey),
        new TextEncoder().encode(JSON.stringify(this.roomInfo)),
      );

    if (this.ownerKeyPair) args.ownerToken = await this.getOwnerToken();
    if (this.ownerAddress) args.ownerAddress = this.ownerAddress;
    if (this.contractAddress) args.contractAddress = this.contractAddress;
    if (this.identityToken) args.identityToken = this.identityToken;

    // Re-mint on every /auth (incl. reconnect, rekey). ok → use + cache the fresh token;
    // unavailable (transient/network) → fall back to the last-good claim so a blip doesn't
    // self-demote; demoted → leave undefined so the ensuing 403 is genuinely terminal.
    let editUcan: string | undefined;
    if (this.refreshEditClaim) {
      const r = await this.refreshEditClaim();
      if (r.status === 'ok') {
        editUcan = r.token;
        this.lastGoodEditUcan = r.token;
      } else if (r.status === 'unavailable') {
        editUcan = this.lastGoodEditUcan ?? this.editUcan;
      }
    } else {
      editUcan = this.editUcan;
    }
    if (editUcan) args.editUcan = editUcan;
    if (this.actorHandle) args.actorHandle = this.actorHandle;
    if (this.joinOnly) args.joinOnly = true;
    if (opts?.rotationCutover) args.rotationCutover = true;

    const response = await this._emitWithAck('/auth', args);

    // Always notify consumer with handshake data (for room info, link copying, etc.)
    this._onHandshakeData?.({
      data: response,
      roomKey: this.roomKey,
    });

    return response;
  };

  private _handleHandShake = async (
    message: { server_did: string; message: string },
    config: ISocketInitConfig,
  ) => {
    this._websocketServiceDid = message.server_did;

    if (this._webSocketStatus === SocketStatusEnum.CLOSED || !this.roomId) {
      throw new Error(
        'Cannot establish handshake. WebSocket not connected or roomId not defined',
      );
    }

    const response = await this._authenticate();

    // Check statusCode FIRST — only proceed for 200
    if (response.statusCode !== 200) {
      const message =
        (response?.error || 'Unknown error') +
        `, statusCode: ${response?.statusCode}`;
      const error = new Error(message);
      config.onHandShakeError(error, response.statusCode, response.errorCode);
      return;
    }

    this._webSocketStatus = SocketStatusEnum.CONNECTED;
    config.onHandshakeSuccess();

    // Presence: fetch the authoritative roster, then stamp our socket id into awareness
    // (the sibling join key), then emit. Runs on first connect and every reconnect
    // (socket.id changes on reconnect). _onPresenceChange is set only after the roster is
    // populated so the first emit is never an empty flash.
    await this._fetchRoomMembers().catch(() => {}); // retain last-known on fetch failure
    this._onPresenceChange = config.onPresenceChange;
    this._stampSocketId();
    this._recomputePresence();
  };

  private _handleAwarenessUpdate = (data: { data: any; roomId: string }) => {
    if (!this.awareness) {
      // Awareness only exists once the session reaches 'ready'; peer identity
      // broadcast in the window before that would be silently lost and only
      // healed by the next ~15-30s awareness renewal. Hold and replay instead.
      if (this._pendingAwarenessUpdates.length < 64) {
        this._pendingAwarenessUpdates.push(data);
      }
      return;
    }

    const key = this.roomKey;
    const encryptedPosition = data.data.position as string;
    if (key) {
      try {
        const decrypted = crypto.decryptData(
          toUint8Array(key),
          encryptedPosition,
        );
        applyAwarenessUpdate(
          this.awareness,
          new Uint8Array(decrypted),
          'remote',
        );
      } catch (err) {
        console.warn(
          'sync-machine: failed to decrypt awareness update, skipping',
          err,
        );
      }
    }
  };

  public connectSocket(config: ISocketInitConfig) {
    if (
      this._webSocketStatus === SocketStatusEnum.CONNECTED ||
      this._webSocketStatus === SocketStatusEnum.CONNECTING
    ) {
      return Promise.resolve();
    }

    this._webSocketStatus = SocketStatusEnum.CONNECTING;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      this._socket = io(this._socketUrl, {
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1500,
        timeout: 6000,
        transports: ['websocket', 'polling'],
      });

      // Safety net: reject if connection isn't established within 60s
      const connectionTimeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._webSocketStatus = SocketStatusEnum.CLOSED;
          const error = new Error('Connection timed out after 30s');
          error.name = 'SocketConnectionTimeoutError';
          config.onError(error);
          reject(error);
          this.disconnect();
        }
      }, 30000);

      this._socket.on('connect', () => {
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimeout);
        }
        this._webSocketStatus = SocketStatusEnum.CONNECTING;
        resolve();
      });

      // Server handshake event — triggers auth flow
      this._socket.on('/server/handshake', (message) => {
        this._handleHandShake(message, config).catch((err) => {
          config.onHandShakeError(err);
        });
      });

      // Server broadcast listeners
      this._socket.on('/document/content_update', (data) => {
        config.onContentUpdate(data);
      });

      this._socket.on('/document/awareness_update', (data) => {
        this._handleAwarenessUpdate(data);
      });

      this._socket.on(
        '/document/meta_update' as any,
        (data: { roomId: string; title: string | null }) => {
          if (data?.roomId !== this.roomId) return;
          this.encryptedTitle = data.title ?? undefined;
          config.onTitleUpdate?.(data.title ?? null);
        },
      );

      this._socket.on('/room/membership_change', (data) => {
        this._fetchRoomMembers()
          .then(() => this._recomputePresence())
          .catch(console.error);
        // Re-broadcast our full awareness state so a late joiner gets our
        // identity immediately instead of waiting for the next heartbeat.
        this._stampSocketId();
        config.onMembershipChange(data);
      });

      this._socket.on('/session/terminated', (data) => {
        // A rekey's in-place re-auth can trigger this on its own leave of the outgoing
        // session — the manager drives that migration, so don't surface it as a kick.
        if (this._rotating) return;
        config.onSessionTerminated(data);
        this._onSessionTerminated();
      });

      this._socket.on(
        '/session/epoch_available' as any,
        (data: { roomId: string; epoch: number; payload: string }) => {
          void this._onEpochAvailable?.(data);
        },
      );

      this._socket.on(
        '/session/cutover' as any,
        (data: { roomId: string; epoch: number }) => {
          void this._onCutover?.(data);
        },
      );

      this._socket.on('/server/error' as any, (data: any) => {
        console.error('SocketAPI: server error event', data);
        const error = new Error(data?.message || 'Server error');
        error.name = 'ServerError';
        config.onError(error);
      });

      this._socket.on('ping', (data) => {
        console.log('SocketAPI: ping event', data);
        this._socket?.emit('pong', { message: 'pong' });
      });

      this._socket.on('disconnect', (reason) => {
        console.error('SocketAPI: socket disconnected');
        this._webSocketStatus = SocketStatusEnum.CLOSED;

        // Clean up remote awareness states (prevents ghost cursors)
        if (this.awareness) {
          const states = this.awareness.getStates();
          const remoteClients = Array.from(states.keys()).filter(
            (clientId) => clientId !== this.awareness!.clientID,
          );
          if (remoteClients.length > 0) {
            removeAwarenessStates(
              this.awareness,
              remoteClients,
              'socket disconnect',
            );
          }
        }

        if (this._isIntentionalDisconnect) {
          config.onDisconnect();
        } else if (reason === 'io server disconnect') {
          // Server force-dropped us (e.g. edit revoked). socket.io will NOT auto-reconnect
          // this reason, so reconnect once to re-auth and learn why (→ 403 → terminated).
          // Do NOT call onSocketDropped here — staying in the current state lets the ensuing
          // SESSION_TERMINATED land from 'ready'.
          this._socket?.connect();
        } else {
          // Unintentional drop — notify SyncManager so it can transition to reconnecting
          config.onSocketDropped();
        }
      });

      this._socket.on('connect_error', (err) => {
        console.error('SocketAPI: socket connect error', err);
        this._webSocketStatus = SocketStatusEnum.CONNECTING;

        if (this.connectionAttemptErrorCount >= 3) {
          clearTimeout(connectionTimeout);
          this.connectionAttemptErrorCount = 0;
          const error = new Error('Failed to establish socket connection');
          error.name = 'SocketConnectionFailedError';
          config.onError(error);
          reject(error);
          this.disconnect();
          // return;
        } else {
          this.connectionAttemptErrorCount++;
        }
      });

      this._socket.on('reconnect_failed', () => {
        console.error('SocketAPI: reconnection failed');
        this._webSocketStatus = SocketStatusEnum.CLOSED;
        config.onReconnectFailed();
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimeout);
          const error = new Error('Failed to reconnect to Socket');
          error.name = 'SocketConnectionFailedError';
          reject(error);
        }
      });

      this._socket.on('reconnect', () => {
        this._isIntentionalDisconnect = false;
        // Status will be set to CONNECTED by _handleHandShake after re-auth
        this._webSocketStatus = SocketStatusEnum.CONNECTING;

        // Re-broadcast local awareness state so other clients see our cursor
        if (this.awareness) {
          const localState = this.awareness.getLocalState();
          if (localState) {
            const update = encodeAwarenessUpdate(this.awareness, [
              this.awareness.clientID,
            ]);
            const key = this.roomKey;
            if (key) {
              const encryptedUpdate = crypto.encryptData(
                toUint8Array(key),
                update,
              );
              this.broadcastAwareness(encryptedUpdate);
            }
          }
        }
      });
    });
  }

  private _onSessionTerminated = () => {
    this.disconnect();
    this.resetSocketClient();
  };

  private resetSocketClient = () => {
    this._webSocketStatus = SocketStatusEnum.CLOSED;
    this._socket = null;
    this._websocketServiceDid = '';
    this.roomId = '';
    this.roomMembers = [];
  };
}
