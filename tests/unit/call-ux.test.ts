import { describe, expect, it } from 'vitest';

import { callStatusLabel, shouldShowCallPanel } from '../../src/features/call/call-panel-state';
import { chatAuthorUsername } from '../../src/features/social/chat-author';

const message = {
  id: 1,
  conversationId: 'conversation_general',
  senderId: 'user_owner',
  clientMessageId: 'message-client-id',
  content: 'Olá',
  createdAt: '2026-08-19T12:00:00.000Z',
  editedAt: null,
  deletedAt: null,
};

describe('painel de chamada', () => {
  it('só é mostrado durante uma chamada que não foi dispensada', () => {
    expect(shouldShowCallPanel('idle', false)).toBe(false);
    expect(shouldShowCallPanel('joining', false)).toBe(true);
    expect(shouldShowCallPanel('connected', false)).toBe(true);
    expect(shouldShowCallPanel('reconnecting', false)).toBe(true);
    expect(shouldShowCallPanel('recovering', false)).toBe(true);
    expect(shouldShowCallPanel('connected', true)).toBe(false);
  });

  it('expõe um status compreensível enquanto a chamada está ativa', () => {
    expect(callStatusLabel('joining')).toBe('Conectando à chamada');
    expect(callStatusLabel('connected')).toBe('Chamada em andamento');
  });
});

describe('autor de mensagem', () => {
  it('sempre identifica a própria mensagem com o username', () => {
    expect(
      chatAuthorUsername({
        message,
        currentUserId: 'user_owner',
        currentUsername: 'owner',
        conversation: null,
        recipient: null,
      }),
    ).toBe('@owner');
  });

  it('usa o cache de membros e um fallback seguro para outros autores', () => {
    const remoteMessage = { ...message, senderId: 'user_member' };
    expect(
      chatAuthorUsername({
        message: remoteMessage,
        currentUserId: 'user_owner',
        currentUsername: 'owner',
        conversation: {
          id: 'conversation_general',
          kind: 'group',
          name: 'K0Sec',
          ownerUserId: 'user_owner',
          callRoomId: 'room_general',
          isDefault: true,
          members: [{ id: 'user_member', username: 'member', displayName: 'Membro' }],
          lastMessage: null,
        },
        recipient: null,
      }),
    ).toBe('@member');
    expect(
      chatAuthorUsername({
        message: remoteMessage,
        currentUserId: 'user_owner',
        currentUsername: 'owner',
        conversation: null,
        recipient: null,
      }),
    ).toBe('@unknown');
  });
});
