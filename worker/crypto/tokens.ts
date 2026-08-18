import {
  RECOVERY_CODE_BYTES,
  RECOVERY_CODE_COUNT,
  TOKEN_BYTES,
} from '../../shared/constants/security';
import { bytesToBase64Url, toArrayBuffer, utf8 } from './encoding';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function generateOpaqueToken(): string {
  return bytesToBase64Url(randomBytes(TOKEN_BYTES));
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(RECOVERY_CODE_BYTES);
    const characters = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte & 31] ?? 'A');
    return Array.from({ length: 8 }, (_, groupIndex) =>
      characters.slice(groupIndex * 4, groupIndex * 4 + 4).join(''),
    ).join('-');
  });
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(utf8(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function keyedIdentifierHash(value: string, pepper: string): Promise<string> {
  return sha256(`${pepper}\u0000${value}`);
}
