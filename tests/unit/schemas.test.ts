import { describe, expect, it } from 'vitest';

import {
  displayNameSchema,
  loginSchema,
  registerInviteSchema,
  usernameSchema,
} from '../../shared/schemas/auth';
import { clientRoomMessageSchema, REALTIME_PROTOCOL_VERSION } from '../../shared/protocol/room';
import { realtimeSessionRequestSchema } from '../../shared/schemas/realtime';
import { groupCreateSchema } from '../../shared/schemas/social';

describe('validação de entrada', () => {
  it('recusa controles e marcadores bidi em nomes de exibição', () => {
    expect(displayNameSchema.safeParse('Alice\nAdmin').success).toBe(false);
    expect(displayNameSchema.safeParse('Alice\u202EAdmin').success).toBe(false);
    expect(displayNameSchema.safeParse('Álice').success).toBe(true);
  });

  it('aceita lote limitado de publicações remotas', () => {
    const base = {
      action: 'subscribe',
      roomId: 'room_general',
      connectionId: crypto.randomUUID(),
      sessionId: 'session_1',
      publicationIds: [crypto.randomUUID()],
    };
    expect(realtimeSessionRequestSchema.safeParse(base).success).toBe(true);
    expect(realtimeSessionRequestSchema.safeParse({ ...base, publicationIds: [] }).success).toBe(
      false,
    );
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
        v: REALTIME_PROTOCOL_VERSION,
        type: 'member.updated',
        payload: { muted: false, deafened: false, userId: crypto.randomUUID() },
      }).success,
    ).toBe(false);
  });

  it('valida chat como texto simples sem aceitar spoofing de remetente', () => {
    const message = {
      v: REALTIME_PROTOCOL_VERSION,
      type: 'chat.send',
      payload: {
        conversationId: 'group_k0sec',
        clientMessageId: crypto.randomUUID(),
        content: '  <script>alert(1)</script>\ntexto  ',
      },
    };
    const parsed = clientRoomMessageSchema.safeParse(message);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === 'chat.send') {
      expect(parsed.data.payload.content).toBe(message.payload.content);
    }
    expect(
      clientRoomMessageSchema.safeParse({
        ...message,
        payload: { ...message.payload, senderId: crypto.randomUUID() },
      }).success,
    ).toBe(false);
    expect(
      clientRoomMessageSchema.safeParse({
        ...message,
        payload: { ...message.payload, content: ' \n ' },
      }).success,
    ).toBe(false);
    expect(
      clientRoomMessageSchema.safeParse({
        ...message,
        payload: { ...message.payload, content: 'a'.repeat(2_001) },
      }).success,
    ).toBe(false);
  });

  it('limita grupos privados a 20 membros incluindo owner', () => {
    expect(
      groupCreateSchema.safeParse({
        name: 'Grupo',
        memberIds: Array.from({ length: 19 }, () => crypto.randomUUID()),
      }).success,
    ).toBe(true);
    expect(
      groupCreateSchema.safeParse({
        name: 'Grupo',
        memberIds: Array.from({ length: 20 }, () => crypto.randomUUID()),
      }).success,
    ).toBe(false);
  });
});
