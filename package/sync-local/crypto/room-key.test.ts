import { describe, it, expect } from 'vitest';
import { fromUint8Array } from 'js-base64';
import { encryptForRoomKey, decryptForRoomKey } from './room-key';
import { WIRE_TAG, isXChaChaCipher } from './index';

const roomKey = fromUint8Array(new Uint8Array(32).fill(7), true);
const otherKey = fromUint8Array(new Uint8Array(32).fill(9), true);
const msg = new TextEncoder().encode('hello-rotation');
const text = (u: Uint8Array) => new TextDecoder().decode(u);

describe('roomKey wrap, ecies (default)', () => {
  it('round-trips bytes under a base64 roomKey', () => {
    const ct = encryptForRoomKey(roomKey, msg);
    expect(typeof ct).toBe('string');
    expect(text(decryptForRoomKey(roomKey, ct))).toBe('hello-rotation');
  });

  it('ecies strings start with A and are not detected as xchacha', () => {
    const ct = encryptForRoomKey(roomKey, msg);
    expect(ct.startsWith('A')).toBe(true);
    expect(isXChaChaCipher(ct)).toBe(false);
  });
});

describe('roomKey wrap, xchacha', () => {
  it('round-trips and carries the FVXC1 tag', () => {
    const ct = encryptForRoomKey(roomKey, msg, 'xchacha');
    expect(ct.startsWith(`${WIRE_TAG}__n__`)).toBe(true);
    expect(ct.split('__n__')).toHaveLength(3);
    expect(isXChaChaCipher(ct)).toBe(true);
    expect(text(decryptForRoomKey(roomKey, ct))).toBe('hello-rotation');
  });

  it('uses a fresh nonce per call', () => {
    const a = encryptForRoomKey(roomKey, msg, 'xchacha');
    const b = encryptForRoomKey(roomKey, msg, 'xchacha');
    expect(a).not.toBe(b);
    expect(a.split('__n__')[1]).not.toBe(b.split('__n__')[1]);
  });

  it('rejects a tampered ciphertext', () => {
    const ct = encryptForRoomKey(roomKey, msg, 'xchacha');
    const parts = ct.split('__n__');
    const body = parts[2];
    const flipped =
      body.slice(0, 4) + (body[4] === 'A' ? 'B' : 'A') + body.slice(5);
    expect(() =>
      decryptForRoomKey(roomKey, [parts[0], parts[1], flipped].join('__n__')),
    ).toThrow();
  });

  it('rejects the wrong key', () => {
    const ct = encryptForRoomKey(roomKey, msg, 'xchacha');
    expect(() => decryptForRoomKey(otherKey, ct)).toThrow();
  });

  it('rejects a malformed FVXC1 string', () => {
    expect(() => decryptForRoomKey(roomKey, `${WIRE_TAG}__n__abc`)).toThrow();
  });

  it('decrypt routes on the string alone, so a mixed log reads back', () => {
    const e = encryptForRoomKey(roomKey, msg);
    const x = encryptForRoomKey(roomKey, msg, 'xchacha');
    expect(text(decryptForRoomKey(roomKey, e))).toBe('hello-rotation');
    expect(text(decryptForRoomKey(roomKey, x))).toBe('hello-rotation');
  });

  it('decrypts a pinned FVXC1 vector', () => {
    // Known-answer vector: roomKey = 32 bytes of 0x11, nonce = 24 bytes of 0x22,
    // plaintext = utf8 "fileverse". Generated once with the shim's own primitives
    // (deriveHKDFKey + xchacha20poly1305) and pinned here as a decrypt-only check.
    const pinnedRoomKey = fromUint8Array(new Uint8Array(32).fill(0x11), true);
    const vector =
      'FVXC1__n__IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIi__n__OsiBUtWLlLepzg63yglbs4+QpaWJxkYvEQ==';
    expect(text(decryptForRoomKey(pinnedRoomKey, vector))).toBe('fileverse');
  });

  it('rejects a wire string whose nonce is not 24 bytes', () => {
    const ct = encryptForRoomKey(roomKey, msg, 'xchacha');
    const parts = ct.split('__n__');
    const shortNonce = fromUint8Array(new Uint8Array(23).fill(1));
    expect(() =>
      decryptForRoomKey(
        roomKey,
        [parts[0], shortNonce, parts[2]].join('__n__'),
      ),
    ).toThrow();
  });

  it('round-trips an empty message under xchacha', () => {
    const ct = encryptForRoomKey(roomKey, new Uint8Array(0), 'xchacha');
    expect(decryptForRoomKey(roomKey, ct).length).toBe(0);
  });

  it('isXChaChaCipher guards non-string input and is true for a fresh xchacha output', () => {
    expect(isXChaChaCipher(undefined)).toBe(false);
    expect(isXChaChaCipher(null)).toBe(false);
    expect(isXChaChaCipher(42)).toBe(false);
    const ct = encryptForRoomKey(roomKey, msg, 'xchacha');
    expect(isXChaChaCipher(ct)).toBe(true);
  });
});
