import { describe, expect, it } from 'vitest';

import {
  displayNameSchema,
  loginSchema,
  registerInviteSchema,
  usernameSchema,
} from '../../shared/schemas/auth';
import { clientRoomMessageSchema } from '../../shared/protocol/room';
import { realtimeSessionRequestSchema } from '../../shared/schemas/realtime';

describe('validação de entrada', () => {
  it('recusa controles e marcadores bidi em nomes de exibição', () => {
    expect(displayNameSchema.safeParse('Alice\nAdmin').success).toBe(false);
    expect(displayNameSchema.safeParse('Alice\u202EAdmin').success).toBe(false);
    expect(displayNameSchema.safeParse('Álice').success).toBe(true);
  });

  it('aceita somente RIDs publicados pela câmera', () => {
    const base = {
      action: 'subscribe',
      roomId: 'room_general',
      connectionId: crypto.randomUUID(),
      sessionId: 'session_1',
      publicationId: crypto.randomUUID(),
    };
    expect(realtimeSessionRequestSchema.safeParse({ ...base, preferredRid: 'b' }).success).toBe(
      true,
    );
    expect(
      realtimeSessionRequestSchema.safeParse({ ...base, preferredRid: 'arbitrary' }).success,
    ).toBe(false);
  });

  it('exige motivo autoritativo ao encerrar uma publicação', () => {
    const closeRequest = {
      action: 'close',
      roomId: 'room_general',
      connectionId: crypto.randomUUID(),
      sessionId: 'session_1',
      publicationId: crypto.randomUUID(),
    };
    expect(realtimeSessionRequestSchema.safeParse(closeRequest).success).toBe(false);
    expect(
      realtimeSessionRequestSchema.safeParse({ ...closeRequest, reason: 'user_stop' }).success,
    ).toBe(true);
    expect(
      realtimeSessionRequestSchema.safeParse({ ...closeRequest, reason: 'network_error' }).success,
    ).toBe(false);
  });
  it('normaliza usernames e recusa nomes reservados ou caracteres inesperados', () => {
    expect(usernameSchema.parse('  Alice.Dev ')).toBe('alice.dev');
    expect(usernameSchema.safeParse('root').success).toBe(false);
    expect(usernameSchema.safeParse('<script>').success).toBe(false);
  });

  it('não altera nem remove espaços da senha', () => {
    const parsed = loginSchema.parse({ username: 'alice', password: ' senha longa com espaço ' });
    expect(parsed.password).toBe(' senha longa com espaço ');
  });

  it('recusa propriedades extras e payloads de impersonation', () => {
    const registration = registerInviteSchema.safeParse({
      inviteToken: 'A'.repeat(43),
      username: 'alice',
      displayName: 'Alice',
      password: 'senha-segura-completa',
      role: 'owner',
    });
    expect(registration.success).toBe(false);
    expect(
      clientRoomMessageSchema.safeParse({
        v: 1,
        type: 'member.updated',
        payload: { muted: false, deafened: false, userId: crypto.randomUUID() },
      }).success,
    ).toBe(false);
  });
});
