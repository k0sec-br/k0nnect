export type UserRole = 'owner' | 'admin' | 'member';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface SessionView {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface RoomView {
  id: string;
  slug: string;
  name: string;
  kind: 'voice';
  position: number;
}

export interface ServerView {
  id: string;
  name: string;
}

export interface MemberView {
  id: string;
  displayName: string;
  role: UserRole;
}

export interface PublicConfig {
  registrationMode: 'disabled' | 'invite' | 'public';
  realtimeEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
}

export type BootstrapView =
  | {
      authenticated: false;
      config: PublicConfig;
    }
  | {
      authenticated: true;
      config: PublicConfig;
      user: SessionUser;
      csrfToken: string;
      server: ServerView;
      channels: RoomView[];
      members: MemberView[];
      capabilities: {
        manageInvites: boolean;
      };
    };

export interface InviteView {
  id: string;
  role: Exclude<UserRole, 'owner'>;
  createdAt: string;
  expiresAt: string;
  status: 'available' | 'used' | 'revoked' | 'expired';
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
