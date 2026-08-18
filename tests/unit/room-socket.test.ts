import { describe, expect, it } from 'vitest';

import { shouldReconnectRoomSocket } from '../../src/features/rooms/use-room-socket';

describe('reconexão da sala', () => {
  it('não disputa a conexão quando a conta entra por outro dispositivo', () => {
    expect(shouldReconnectRoomSocket(4001)).toBe(false);
    expect(shouldReconnectRoomSocket(1000)).toBe(false);
    expect(shouldReconnectRoomSocket(1006)).toBe(true);
  });
});
