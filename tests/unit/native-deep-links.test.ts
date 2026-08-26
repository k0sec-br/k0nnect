import { describe, expect, it } from 'vitest';

import { parseNativeDeepLink } from '../../src/core/navigation/native-deep-links';

const INVITE_TOKEN = 'a'.repeat(43);

describe('deep links nativos', () => {
  it('aceita convites do esquema dedicado e do domínio oficial', () => {
    expect(parseNativeDeepLink(`k0nnect://invite/${INVITE_TOKEN}`)).toEqual({
      type: 'invite',
      token: INVITE_TOKEN,
    });
    expect(parseNativeDeepLink(`https://connect.k0sec.org/invite/${INVITE_TOKEN}`)).toEqual({
      type: 'invite',
      token: INVITE_TOKEN,
    });
  });

  it('aceita conversas com identificadores opacos válidos', () => {
    expect(parseNativeDeepLink('k0nnect://dm/conversation_123')).toEqual({
      type: 'conversation',
      conversationId: 'conversation_123',
    });
  });

  it('recusa origens externas e valores fora da allowlist', () => {
    expect(parseNativeDeepLink(`https://example.com/invite/${INVITE_TOKEN}`)).toBeNull();
    expect(parseNativeDeepLink('k0nnect://dm/../../settings')).toBeNull();
    expect(parseNativeDeepLink('javascript:alert(1)')).toBeNull();
  });
});
