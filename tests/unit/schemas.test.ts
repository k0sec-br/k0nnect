import { describe, expect, it } from 'vitest';

import { loginSchema, registerInviteSchema, usernameSchema } from '../../shared/schemas/auth';
import { clientRoomMessageSchema } from '../../shared/protocol/room';

describe('validação de entrada', () => {
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
