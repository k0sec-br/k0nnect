export const CLOUDFLARE_PBKDF2_MAX_ITERATIONS = 100_000;
export const PASSWORD_ITERATIONS = CLOUDFLARE_PBKDF2_MAX_ITERATIONS;
export const PASSWORD_VERSION = 1;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_HASH_BYTES = 32;
export const TOKEN_BYTES = 32;
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_BYTES = 32;
export const INVITE_LIFETIME_SECONDS = 72 * 60 * 60;
export const SESSION_IDLE_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_TOUCH_INTERVAL_SECONDS = 5 * 60;
export const SECURITY_EVENT_RETENTION_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_COOKIE_NAME = '__Host-k0nnect_session';
export const MAX_JSON_BODY_BYTES = 1_048_576;
export const MAX_WEBSOCKET_MESSAGE_BYTES = 4_096;
export const MAX_WEBSOCKET_INVALID_MESSAGES = 3;

export const RESERVED_USERNAMES = [
  'admin',
  'administrator',
  'api',
  'k0nnect',
  'k0sec',
  'root',
  'security',
  'support',
  'system',
] as const;

export const USER_ROLES = ['owner', 'admin', 'member'] as const;
export const REGISTRATION_MODES = ['disabled', 'invite', 'public'] as const;
