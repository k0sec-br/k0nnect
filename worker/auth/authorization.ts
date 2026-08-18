import type { UserRole } from '../../shared/types/api';
import { AppError } from '../errors/app-error';
import { roomExists } from '../repositories/rooms';
import type { AuthenticatedSession } from './session';

export function requireRole(
  authenticated: AuthenticatedSession,
  allowedRoles: readonly UserRole[],
): void {
  if (!allowedRoles.includes(authenticated.user.role)) throw new AppError('FORBIDDEN', 403);
}

export async function requireRoomAccess(env: Env, roomId: string): Promise<void> {
  if (!(await roomExists(env.DB, roomId))) throw new AppError('ROOM_UNAVAILABLE', 404);
}
