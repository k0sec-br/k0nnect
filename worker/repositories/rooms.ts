import type { RoomView } from '../../shared/types/api';

interface RoomRow {
  id: string;
  slug: string;
  name: string;
  kind: 'voice' | 'text';
  position: number;
}

export async function listVoiceRooms(database: D1Database): Promise<RoomView[]> {
  const result = await database
    .prepare(
      "SELECT id, slug, name, kind, position FROM rooms WHERE kind = 'voice' ORDER BY position, name",
    )
    .all<RoomRow>();
  return result.results.map((room) => ({ ...room, kind: 'voice' }));
}

export async function roomExists(database: D1Database, roomId: string): Promise<boolean> {
  const room = await database
    .prepare("SELECT id FROM rooms WHERE id = ? AND kind = 'voice' LIMIT 1")
    .bind(roomId)
    .first<{ id: string }>();
  return room !== null;
}
