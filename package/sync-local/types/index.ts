/* eslint-disable @typescript-eslint/no-explicit-any */
import { Data, IDocCollabUsers } from '../../types';
import * as Y from 'yjs';

/** Collab wire cipher. `ecies` is the historical secp256k1 ECIES; `xchacha` is
 *  XChaCha20-Poly1305 under an HKDF subkey of the roomKey (FVXC1). */
export type WireFormat = 'ecies' | 'xchacha';

/** Host telemetry for the wire migration; the package never imports a reporter. */
export type WireTelemetryEvent =
  | { type: 'announced'; format: WireFormat }
  | { type: 'write'; format: WireFormat }
  | {
      type: 'hydrate';
      eciesRows: number;
      xchachaRows: number;
      snapshotFormat: WireFormat | null;
      incomplete: boolean;
    }
  | { type: 'refused' };

// ─── Collaboration prop types ───

/** Connection identity — changes to these trigger reconnect */
export interface CollabConnectionConfig {
  roomKey: string;
  roomId: string;
  wsUrl: string;
  isOwner: boolean;
  /** Host signal: doc is in an active live-collaboration context (shared / peers present). Keeps the socket connected. */
  livePresence?: boolean;
  /** Host signal: connect once on open to initialise durability even without an edit. */
  connectOnOpen?: boolean;
  /** Host signal (owner-only): wrapped roomKey bytes (owner-lock construction), uploaded as the server editLock recovery artifact. Opaque to the package. */
  editLock?: string;
  /** Host signal (owner-only): the document title encrypted with the roomKey, uploaded as the server title recovery artifact. Opaque to the package. */
  encryptedTitle?: string;
  /** Host signal (owner-only): Ed25519 UCAN proving the owner identity, sent on /auth so the server binds the CRYPTOGRAPHICALLY PROVEN owner DID (not a bare asserted string). Opaque to the package. */
  identityToken?: string;
  /** Host signal (non-owner editor): the gate-minted edit-admission UCAN, forwarded on /auth so the
   *  server admits this connection as a GP-rail editor. Opaque to the package. */
  editUcan?: string;
  /** Host signal (non-owner editor): re-mints a CURRENT-epoch editUcan. Called at every /auth
   *  (incl. reconnect after a force-drop). Tri-state: `ok` (fresh token; overrides the static
   *  `editUcan`), `demoted` (no longer an editor → terminal, drop to viewer), or `unavailable`
   *  (transient/network → retry on the last-good claim). Opaque to the package. */
  refreshEditClaim?: () => Promise<
    | { status: 'ok'; token: string }
    | { status: 'demoted' }
    | { status: 'unavailable' }
  >;
  /** Host signal: resolves the rotated roomKey for the given epoch payload (GP: gate release
   *  unwrap of `gp`; workspace: app-key unwrap of `appLock`). Returns the new base64 roomKey —
   *  or, for a gate-admitted editor, `{ roomKey, editUcan }`: the same gate release that unwraps
   *  the relay also mints the new-epoch editUcan, and the cutover re-auth must present THAT token
   *  (a re-mint through the host's fresh-open flow can race the deferred publish and hand back a
   *  stale-epoch claim). `null` if this actor can't resolve it (falls back to the decrypt-miss
   *  self-heal path). Opaque to the package. */
  onRotationPrepare?: (inner: {
    epoch: number;
    gp: string;
    appLock?: string;
  }) => Promise<string | { roomKey: string; editUcan?: string } | null>;
  /** Host signal: an anonymous per-connection actor handle (public rail). Record-only; opaque. */
  actorHandle?: string;
  /** Host signal (non-creator workspace member): join-only. The server never creates or
   *  binds a session for this connection and caps the role at editor; every handshake
   *  rejection resolves to a quiet terminated state ('ROOM_NOT_ESTABLISHED' when the room
   *  was never established, 'JOIN_REJECTED' otherwise) instead of an error. */
  joinOnly?: boolean;
  /** Host signal (editor): produces the view-plane mirror ciphertext from the live Yjs state. The app
   *  AES-GCM-encrypts `{ file: base64(yjsUpdate), source }` under the fileKey in the publish wire
   *  format. Absent ⇒ the mirror is not written. The package never sees the fileKey or the crypto. */
  encryptMirror?: (yjsUpdate: Uint8Array) => Promise<string>;
  /** Host signal: the fileKey's rotation epoch (the gate `currentEpoch` / fileKey version — NOT
   *  `editGrantEpoch`; default 0 for non-rotating plain-public docs). */
  fileKeyEpoch?: number;
  ownerEdSecret?: string;
  contractAddress?: string;
  ownerAddress?: string;
  roomInfo?: {
    documentTitle: string;
    portalAddress: string;
    commentKey: string;
  };
}

/** Session metadata — changes to these update awareness, NOT reconnect */
export interface CollabSessionMeta {
  username: string;
  isEns?: boolean;
}

// Host-seeds model: the sync engine performs no IPFS/fileKey I/O. The host app loads
// the published artifact into the Y.Doc; Yjs idempotency merges it with the server
// tail. Reserved for future host integrations.
export type CollabServices = Record<string, never>;

// ─── State Machine Types ───

export type CollabErrorCode =
  | 'CONNECTION_FAILED'
  | 'AUTH_FAILED'
  | 'SYNC_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export type CollabError = {
  code: CollabErrorCode;
  message: string;
  recoverable: boolean;
};

export type CollabStatus =
  | 'idle'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'reconnecting'
  | 'rotating'
  | 'error'
  | 'terminated';

export type CollabState =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'syncing'; hasUnmergedPeerUpdates: boolean }
  | { status: 'ready' }
  | { status: 'reconnecting'; attempt: number; maxAttempts: number }
  /** roomKey migration in flight — distinct from `terminated` so consumers don't mistake it for a kick. */
  | { status: 'rotating' }
  | { status: 'error'; error: CollabError }
  | { status: 'terminated'; reason?: string };

export type CollabEvent =
  | { type: 'CONNECT' }
  | { type: 'AUTH_SUCCESS' }
  | { type: 'SYNC_COMPLETE' }
  | { type: 'SET_UNMERGED_UPDATES'; hasUpdates: boolean }
  | { type: 'SOCKET_DROPPED' }
  | { type: 'RECONNECTED' }
  | { type: 'RETRY_EXHAUSTED' }
  | { type: 'ERROR'; error: CollabError }
  | { type: 'SESSION_TERMINATED'; reason?: string }
  /** roomKey cutover in progress; no-op on status — lets the manager gate re-entrancy itself. */
  | { type: 'CUTOVER' }
  | { type: 'RESET' };

export interface CollabContext {
  hasUnmergedPeerUpdates: boolean;
  reconnectAttempt: number;
  maxReconnectAttempts: number;
  error: CollabError | null;
  terminationReason?: string;
}

/** Event callbacks the consumer reacts to */
export interface CollabCallbacks {
  onStateChange?: (state: CollabState) => void;
  onError?: (error: CollabError) => void;
  onCollaboratorsChange?: (collaborators: IDocCollabUsers[]) => void;
  onHandshakeData?: (data: {
    data: AckResponse;
    roomKey: string;
    wireFormat: WireFormat;
  }) => void;
  /** The write format the server announced for this room (auth ack or live ratchet). */
  onWireFormat?: (format: WireFormat) => void;
  onWireTelemetry?: (event: WireTelemetryEvent) => void;
  /** Live rename from the room owner; title is roomKey-encrypted. */
  onTitleUpdate?: (encryptedTitle: string | null) => void;
  /** Decrypt-miss self-heal: resolves the CURRENT-epoch roomKey (same resolution the host
   *  uses for `onRotationPrepare`, minus the relay payload — re-read the blob's
   *  `wrappedRoomKey` / appLock). Returns the new base64 roomKey, or `null` if this actor
   *  can't resolve one (the miss is then a real revocation, not a rotation lag). */
  onRotationSelfHeal?: () => Promise<string | null>;
}

/** Discriminated union — TypeScript enforces config+services only when enabled */
export type CollaborationProps =
  | { enabled: false }
  | {
      enabled: true;
      connection: CollabConnectionConfig;
      session: CollabSessionMeta;
      services: CollabServices;
      on?: CollabCallbacks;
    };

// ─── Internal sync types ───

export interface SyncManagerConfig {
  ydoc: Y.Doc;
  services?: CollabServices;
  callbacks?: CollabCallbacks;
  onLocalUpdate?: (
    updatedDocContent: Data['editorJSONData'],
    updateChunk: string,
  ) => void;
  /** Origins to ignore in the ydoc update handler (e.g. IndexedDB provider) */
  ignoredOrigins?: Array<{ current: unknown }>;
}

export enum ServerErrorCode {
  AUTH_TOKEN_MISSING = 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_TERMINATED = 'SESSION_TERMINATED',
  SESSION_DID_MISSING = 'SESSION_DID_MISSING',
  DOCUMENT_ID_MISSING = 'DOCUMENT_ID_MISSING',
  UPDATE_DATA_MISSING = 'UPDATE_DATA_MISSING',
  COMMIT_UNAUTHORIZED = 'COMMIT_UNAUTHORIZED',
  COMMIT_MISSING_DATA = 'COMMIT_MISSING_DATA',
  INVALID_ADDRESS = 'INVALID_ADDRESS',
  NOT_AUTHENTICATED = 'NOT_AUTHENTICATED',
  DB_ERROR = 'DB_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  JOIN_DISABLED = 'JOIN_DISABLED',
  EDIT_REVOKED = 'EDIT_REVOKED',
  ROOM_NOT_ESTABLISHED = 'ROOM_NOT_ESTABLISHED',
  WIRE_FORMAT_UNSUPPORTED = 'WIRE_FORMAT_UNSUPPORTED',
}

export interface AckResponse<T = Record<string, any>> {
  status: boolean;
  statusCode: number;
  data?: T;
  error?: string;
  errorCode?: ServerErrorCode;
}

export interface SendUpdateResponse
  extends AckResponse<{
    id: string;
    documentId: string;
    data: string;
    updateType: string;
    commitCid: string | null;
    createdAt: number;
  }> {}

export interface HydrationRow {
  id: string;
  documentId: string;
  seq: number;
  data: string;
  updateType: string;
  committed?: boolean;
  commitCid?: string | null;
  createdAt?: number;
  sessionDid?: string;
  publishedMarker?: string | null;
  floorSeq?: number | null;
}

export interface HydrationResponse
  extends AckResponse<{
    history: HydrationRow[];
    total: number;
    snapshot: HydrationRow | null;
    nextSeq: number | null;
    hasMore: boolean;
  }> {}

export interface SnapshotResponse
  extends AckResponse<{ id: string; seq: number }> {}

export interface ISocketInitConfig {
  onHandshakeSuccess: () => void;
  onDisconnect: () => void;
  onSocketDropped: () => void;
  onError: (err: Error) => void;
  onHandShakeError: (
    err: Error,
    statusCode?: number,
    errorCode?: ServerErrorCode,
  ) => void;
  onContentUpdate: (data: {
    id: string;
    data: string;
    createdAt: number;
    roomId: string;
  }) => void;
  onMembershipChange: (data: {
    action: string;
    user: { role: string };
    roomId: string;
  }) => void;
  onPresenceChange?: (collaborators: IDocCollabUsers[]) => void;
  onTitleUpdate?: (encryptedTitle: string | null) => void;
  onWireFormat?: (data: { roomId: string; wireFormat: WireFormat }) => void;
  onSessionTerminated: (data: { roomId: string }) => void;
  onReconnectFailed: () => void;
}

export enum SocketStatusEnum {
  CLOSED = 'CLOSED',
  CONNECTED = 'CONNECTED',
  CONNECTING = 'CONNECTING',
  DISCONNECTING = 'DISCONNECTING',
  DISCONNECTED = 'DISCONNECTED',
}

export interface RoomMember {
  username: string;
  userId: string;
  role: 'owner' | 'editor';
}

export interface IAuthArgs {
  collaborationToken: string;
  documentId: string;
  ownerToken?: string;
  ownerAddress?: string;
  contractAddress?: string;
  sessionDid?: string;
  roomInfo?: string;
  identityToken?: string;
  editUcan?: string;
  actorHandle?: string;
  joinOnly?: boolean;
  wireFormats?: WireFormat[];
}
