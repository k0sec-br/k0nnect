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
