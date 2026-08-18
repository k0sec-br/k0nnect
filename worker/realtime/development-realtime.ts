import type { RealtimeSessionRequest } from '../../shared/schemas/realtime';
import { AppError } from '../errors/app-error';

export function developmentRealtimeResponse(input: RealtimeSessionRequest): unknown {
  if (input.action === 'create')
    return { sessionId: `local_${crypto.randomUUID().replaceAll('-', '')}` };
  if (input.action === 'turn') {
    return { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] };
  }
  throw new AppError('REALTIME_DISABLED', 503);
}
