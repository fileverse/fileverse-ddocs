// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as ucans from '@ucans/ucans';
import { fromUint8Array } from 'js-base64';
import { SocketClient } from './socketClient';

type AuthArgs = {
  collaborationToken: string;
  ownerToken: string;
  sessionDid: string;
};

const socketStub = vi.hoisted(() => ({
  handlers: new Map<string, (payload?: unknown) => void>(),
  onAuth: (() => {}) as (args: AuthArgs) => void,
}));

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, handler: (payload?: unknown) => void) => {
      socketStub.handlers.set(event, handler);
    },
    emit: (
      event: string,
      args: AuthArgs,
      ack?: (response: unknown) => void,
    ) => {
      if (event !== '/auth') return;
      socketStub.onAuth(args);
      ack?.({ status: false, statusCode: 500, error: 'stop after /auth' });
    },
    connect: () => {},
    disconnect: () => {},
    connected: true,
    io: { on: () => {} },
  }),
}));

const PORTAL = '0x26d2873a4ff78f7b014a28152a533dbc8426a89c';
const realNow = Date.now.bind(Date);

const accepted = async (
  token: string,
  serverDid: string,
  rootIssuer: string,
  hierPart: string,
  segment: string,
) =>
  (
    await ucans.verify(token, {
      audience: serverDid,
      requiredCapabilities: [
        {
          capability: {
            with: { scheme: 'storage', hierPart },
            can: { namespace: 'collaboration', segments: [segment] },
          },
          rootIssuer,
        },
      ],
    })
  ).ok;

/** Opens a socket on a device clock off by `skewMs` and returns the tokens /auth carried. */
const authOnSkewedDevice = async (skewMs: number, sendServerTime: boolean) => {
  const server = await ucans.EdKeypair.create();
  const owner = await ucans.EdKeypair.create({ exportable: true });
  const client = new SocketClient({
    wsUrl: 'ws://collab.test',
    roomKey: fromUint8Array(crypto.getRandomValues(new Uint8Array(32))),
    roomId: 'doc-1',
    ownerEdSecret: await owner.export(),
    contractAddress: PORTAL,
    ownerAddress: '0x1a1163d478693aa7febe1cbca3b6a4b00d1a231d',
  });
  const authArgs = new Promise<AuthArgs>((resolve) => {
    socketStub.onAuth = resolve;
  });

  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skewMs);
  void client.connectSocket({
    onHandshakeSuccess: vi.fn(),
    onDisconnect: vi.fn(),
    onSocketDropped: vi.fn(),
    onError: vi.fn(),
    onHandShakeError: vi.fn(),
    onContentUpdate: vi.fn(),
    onMembershipChange: vi.fn(),
    onSessionTerminated: vi.fn(),
    onReconnectFailed: vi.fn(),
  });
  socketStub.handlers.get('connect')!();
  socketStub.handlers.get('/server/handshake')!({
    server_did: server.did(),
    message: 'Connected to collaboration server',
    ...(sendServerTime ? { server_time: realNow() } : {}),
  });
  const args = await authArgs;
  vi.restoreAllMocks();

  return {
    collabOk: await accepted(
      args.collaborationToken,
      server.did(),
      args.sessionDid,
      'doc-1',
      'COLLABORATE',
    ),
    ownerOk: await accepted(
      args.ownerToken,
      server.did(),
      owner.did(),
      PORTAL,
      'CREATE',
    ),
  };
};

describe('SocketClient /auth tokens on a skewed device clock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    socketStub.handlers.clear();
  });

  it.each([
    ['77 s ahead', 77_000],
    ['2 h behind', -2 * 3600_000],
  ])(
    'are accepted when the device clock is %s and the server sends its time',
    async (_label, skewMs) => {
      expect(await authOnSkewedDevice(skewMs, true)).toEqual({
        collabOk: true,
        ownerOk: true,
      });
    },
  );

  it('are built on the device clock when the server sends no time', async () => {
    expect(await authOnSkewedDevice(77_000, false)).toEqual({
      collabOk: false,
      ownerOk: false,
    });
  });
});
