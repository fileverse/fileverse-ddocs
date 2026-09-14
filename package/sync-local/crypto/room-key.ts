import { toUint8Array } from 'js-base64';
import { crypto } from './index';
import type { WireFormat } from '../types';

// Outer wrap of the rotation relay: the same cipher the collab wire uses, keyed by a
// base64 roomKey string. Owner encrypts under the pre-rotation roomKey in the format the
// room announced; members decrypt with it (decrypt routes on the string).
export const encryptForRoomKey = (
  roomKey: string,
  bytes: Uint8Array,
  format: WireFormat = 'ecies',
): string => crypto.encryptData(toUint8Array(roomKey), bytes, format);

export const decryptForRoomKey = (
  roomKey: string,
  ciphertext: string,
): Uint8Array => crypto.decryptData(toUint8Array(roomKey), ciphertext);
