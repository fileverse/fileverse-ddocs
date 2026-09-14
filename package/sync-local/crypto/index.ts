import {
  generateECKeyPair,
  eciesDecrypt,
  eciesEncrypt,
} from '@fileverse/crypto/ecies';
import { deriveHKDFKey } from '@fileverse/crypto/kdf';
import { generateRandomBytes } from '@fileverse/crypto/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { fromUint8Array, toUint8Array } from 'js-base64';
import type { WireFormat } from '../types';

// Collab wire cipher. `ecies` is byte-identical to the historical shim; `xchacha` seals
// under an HKDF subkey of the roomKey and tags the string so decrypt can route without a
// flag.
export const WIRE_TAG = 'FVXC1';
const SEPARATOR = '__n__';
const WIRE_PREFIX = WIRE_TAG + SEPARATOR;
const WIRE_INFO = new TextEncoder().encode(
  'FILEVERSE-COLLAB-WIRE-XCHACHA20POLY1305-FVXC1',
);
const NONCE_LEN = 24;
const MEMO_CAP = 8;

// Subkey memo keyed by the base64 roomKey: one derivation per socket, one more per rekey.
const wireKeys = new Map<string, Uint8Array>();

const wireKeyFor = (roomKey: Uint8Array): Uint8Array => {
  const id = fromUint8Array(roomKey);
  const hit = wireKeys.get(id);
  if (hit) return hit;
  const derived = deriveHKDFKey(roomKey, new Uint8Array(0), WIRE_INFO);
  if (wireKeys.size >= MEMO_CAP) {
    const oldest = wireKeys.keys().next().value;
    if (oldest !== undefined) wireKeys.delete(oldest);
  }
  wireKeys.set(id, derived);
  return derived;
};

export const isXChaChaCipher = (message: unknown): message is string =>
  typeof message === 'string' && message.startsWith(WIRE_PREFIX);

export const crypto = {
  generateKeyPair: () => {
    return generateECKeyPair();
  },
  encryptData: (
    key: Uint8Array,
    message: Uint8Array,
    format: WireFormat = 'ecies',
  ): string => {
    if (format === 'xchacha') {
      const nonce = generateRandomBytes(NONCE_LEN);
      const sealed = xchacha20poly1305(wireKeyFor(key), nonce).encrypt(message);
      return (
        WIRE_PREFIX + fromUint8Array(nonce) + SEPARATOR + fromUint8Array(sealed)
      );
    }
    const pubKey = secp256k1.getPublicKey(key);
    return eciesEncrypt(pubKey, message, 'base64');
  },
  decryptData: (key: Uint8Array, message: string): Uint8Array => {
    if (isXChaChaCipher(message)) {
      const parts = message.split(SEPARATOR);
      if (parts.length !== 3 || !parts[1] || !parts[2]) {
        throw new Error('Invalid FVXC1 wire format');
      }
      const nonce = toUint8Array(parts[1]);
      if (nonce.length !== NONCE_LEN) {
        throw new Error('Invalid FVXC1 nonce length');
      }
      return xchacha20poly1305(wireKeyFor(key), nonce).decrypt(
        toUint8Array(parts[2]),
      );
    }
    return eciesDecrypt(key, message);
  },
  generateRandomBytes,
};
