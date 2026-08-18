import {
  CLOUDFLARE_PBKDF2_MAX_ITERATIONS,
  PASSWORD_HASH_BYTES,
  PASSWORD_ITERATIONS,
  PASSWORD_SALT_BYTES,
  PASSWORD_VERSION,
} from '../../shared/constants/security';
import { base64UrlToBytes, bytesToBase64Url, toArrayBuffer, utf8 } from './encoding';
import { randomBytes } from './tokens';

export interface PasswordRecord {
  hash: string;
  salt: string;
  iterations: number;
  version: number;
}

async function derivePassword(
  password: string,
  pepper: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(utf8(`${password}\u0000${pepper}`)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, pepper: string): Promise<PasswordRecord> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const hash = await derivePassword(password, pepper, salt, PASSWORD_ITERATIONS);
  return {
    hash: bytesToBase64Url(hash),
    salt: bytesToBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
    version: PASSWORD_VERSION,
  };
}

export async function verifyPassword(
  password: string,
  pepper: string,
  record: PasswordRecord,
): Promise<boolean> {
  if (
    record.version !== PASSWORD_VERSION ||
    record.iterations < PASSWORD_ITERATIONS ||
    record.iterations > CLOUDFLARE_PBKDF2_MAX_ITERATIONS
  ) {
    return false;
  }
  const expected = base64UrlToBytes(record.hash);
  const actual = await derivePassword(
    password,
    pepper,
    base64UrlToBytes(record.salt),
    record.iterations,
  );
  return (
    expected.byteLength === actual.byteLength && crypto.subtle.timingSafeEqual(expected, actual)
  );
}

const DUMMY_PASSWORD_RECORD: PasswordRecord = {
  hash: '4qMRX2voY7GGGsv1cqP7jBHhJ7mO3Imo7N4TQ3HXpxI',
  salt: 'MDAxMTIyMzM0NDU1NjY3Nw',
  iterations: PASSWORD_ITERATIONS,
  version: PASSWORD_VERSION,
};

export async function performDummyPasswordVerification(
  password: string,
  pepper: string,
): Promise<void> {
  await verifyPassword(password, pepper, DUMMY_PASSWORD_RECORD);
}
