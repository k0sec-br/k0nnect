import { describe, expect, it } from 'vitest';

import {
  roomSocketIsStale,
  shouldReconnectRoomSocket,
} from '../../src/features/rooms/use-room-socket';

describe('reconexão da sala', () => {
  it('não disputa a conexão quando a conta entra por outro dispositivo', () => {
    expect(shouldReconnectRoomSocket(4001)).toBe(false);
    expect(shouldReconnectRoomSocket(1000)).toBe(false);
    expect(shouldReconnectRoomSocket(1006)).toBe(true);
  });

  it('tolera throttling de heartbeat em background sem mascarar conexão obsoleta', () => {
    const now = 1_000_000;
    expect(roomSocketIsStale(now - 69_000, 'visible', now)).toBe(false);
    expect(roomSocketIsStale(now - 71_000, 'visible', now)).toBe(true);
    expect(roomSocketIsStale(now - 200_000, 'hidden', now)).toBe(false);
    expect(roomSocketIsStale(now - 211_000, 'hidden', now)).toBe(true);
  });
});
