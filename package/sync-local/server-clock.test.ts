// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as ucans from '@ucans/ucans';
import { ServerClock } from './server-clock';

const START = 1_800_000_000_000;
const seconds = (ms: number) => Math.floor(ms / 1000);
const ucanWith = (payload: { nbf?: number; exp: number }) =>
  ({ payload }) as unknown as ucans.Ucan;

/** A device wall clock and monotonic clock that a test can move independently. */
const deviceClocks = () => {
  let wall = START;
  let mono = 1_000;
  return {
    wall: () => wall,
    mono: () => mono,
    elapse: (ms: number) => {
      wall += ms;
      mono += ms;
    },
    moveWallOnly: (ms: number) => {
      wall += ms;
    },
  };
};
const clockOn = (device: ReturnType<typeof deviceClocks>) =>
  new ServerClock(device.wall, device.mono);

describe('ServerClock', () => {
  it('uses the device clock until a handshake supplies the server time', () => {
    expect(clockOn(deviceClocks()).nowSeconds()).toBe(seconds(START));
  });

  it('adopts the server time from the handshake and keeps time from there', () => {
    const device = deviceClocks();
    const clock = clockOn(device);

    clock.sync(START - 77_000);
    expect(clock.nowSeconds()).toBe(seconds(START - 77_000));
    device.elapse(5_000);
    expect(clock.nowSeconds()).toBe(seconds(START - 72_000));

    clock.sync(device.wall() + 2 * 3600_000);
    expect(clock.nowSeconds()).toBe(seconds(device.wall() + 2 * 3600_000));
  });

  it.each([300_000, -300_000])(
    'ignores a device clock change of %i ms mid-session',
    (change) => {
      const device = deviceClocks();
      const clock = clockOn(device);
      clock.sync(START - 77_000);

      device.moveWallOnly(change);
      device.elapse(1_000);
      expect(clock.nowSeconds()).toBe(seconds(START - 76_000));
    },
  );

  it('trails the server, never leads it, when the monotonic clock pauses in sleep', () => {
    const device = deviceClocks();
    const clock = clockOn(device);
    clock.sync(START);

    // 10 s of sleep: the wall clock moved, the monotonic clock did not.
    device.moveWallOnly(10_000);
    expect(clock.nowSeconds()).toBe(seconds(START));
  });

  it('measures elapsed time on the device clock when no monotonic clock exists', () => {
    const device = deviceClocks();
    const clock = new ServerClock(device.wall, null);

    clock.sync(START - 77_000);
    device.elapse(5_000);
    expect(clock.nowSeconds()).toBe(seconds(START - 72_000));
  });

  it.each([
    undefined,
    null,
    NaN,
    Infinity,
    '1800000000000',
    0,
    -5,
    1_800_000_000,
    1_800_000_000_000_000,
  ])(
    'falls back to the device clock for a missing or invalid server time (%s)',
    (bad) => {
      const device = deviceClocks();
      const clock = clockOn(device);
      clock.sync(START + 3600_000);
      clock.sync(bad);
      expect(clock.nowSeconds()).toBe(seconds(START));
    },
  );

  it('builds the UCAN window on server time: 60 s grace before, 1 h after', () => {
    const clock = clockOn(deviceClocks());
    clock.sync(START - 77_000);
    const now = seconds(START - 77_000);
    expect(clock.ucanWindow()).toEqual({
      notBefore: now - 60,
      expiration: now + 3600,
    });
  });

  it('judges a cached UCAN on server time, not the device clock', () => {
    const clock = clockOn(deviceClocks());
    clock.sync(START + 2 * 3600_000);
    const serverNow = seconds(START + 2 * 3600_000);
    const usable = (payload: { nbf?: number; exp: number }) =>
      clock.isUsable(ucanWith(payload));

    expect(usable({ nbf: serverNow - 60, exp: serverNow + 3000 })).toBe(true);
    expect(usable({ exp: serverNow + 3000 })).toBe(true);
    expect(usable({ nbf: serverNow, exp: serverNow + 3600 })).toBe(true);
    expect(usable({ exp: serverNow + 61 })).toBe(true);
    // Fine by the device clock (2 h behind), but already expired for the server.
    expect(
      usable({ nbf: seconds(START) - 60, exp: seconds(START) + 3600 }),
    ).toBe(false);
    expect(usable({ exp: serverNow + 60 })).toBe(false);
    expect(usable({ nbf: serverNow + 1, exp: serverNow + 3600 })).toBe(false);
  });
});

describe('ServerClock UCANs against the server verifier', () => {
  const verifyAtServer = async (
    serverDid: string,
    issuer: ucans.EdKeypair,
    token: string,
  ) =>
    (
      await ucans.verify(token, {
        audience: serverDid,
        requiredCapabilities: [
          {
            capability: {
              with: { scheme: 'storage', hierPart: 'doc-1' },
              can: { namespace: 'collaboration', segments: ['COLLABORATE'] },
            },
            rootIssuer: issuer.did(),
          },
        ],
      })
    ).ok;

  const tokenFor = async (
    serverDid: string,
    issuer: ucans.EdKeypair,
    clock: ServerClock,
  ) =>
    ucans.encode(
      await ucans.build({
        audience: serverDid,
        issuer,
        ...clock.ucanWindow(),
        capabilities: [
          {
            with: { scheme: 'storage', hierPart: 'doc-1' },
            can: { namespace: 'collaboration', segments: ['COLLABORATE'] },
          },
        ],
      }),
    );

  it.each([
    ['77 s ahead', 77_000],
    ['2 h behind', -2 * 3600_000],
    ['1 day ahead', 24 * 3600_000],
  ])(
    'is accepted when the device clock is %s once synced',
    async (_label, skewMs) => {
      const server = await ucans.EdKeypair.create();
      const issuer = await ucans.EdKeypair.create();

      const unsynced = new ServerClock(() => Date.now() + skewMs);
      expect(
        await verifyAtServer(
          server.did(),
          issuer,
          await tokenFor(server.did(), issuer, unsynced),
        ),
      ).toBe(false);

      const synced = new ServerClock(() => Date.now() + skewMs);
      synced.sync(Date.now());
      expect(
        await verifyAtServer(
          server.did(),
          issuer,
          await tokenFor(server.did(), issuer, synced),
        ),
      ).toBe(true);
    },
  );
});
