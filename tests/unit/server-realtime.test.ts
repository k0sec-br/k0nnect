import { describe, expect, it } from 'vitest';

import { shouldReconnectServerSocket } from '../../src/features/rooms/use-server-realtime';

describe('reconexão realtime', () => {
  it('reconecta falhas transitórias e respeita encerramentos explícitos', () => {
    expect(shouldReconnectServerSocket(1000)).toBe(false);
    expect(shouldReconnectServerSocket(4003)).toBe(false);
    expect(shouldReconnectServerSocket(1006)).toBe(true);
    expect(shouldReconnectServerSocket(4004)).toBe(true);
  });
});
