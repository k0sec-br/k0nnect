import type { RoomView } from '../../shared/types/api';

interface RoomRow {
  id: string;
  slug: string;
  name: string;
  kind: 'voice' | 'text';
  position: number;
}

export async function listVoiceRooms(database: D1Database, userId: string): Promise<RoomView[]> {
  const result = await database
    .prepare(
      `SELECT r.id, r.slug, r.name, r.kind, r.position
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       JOIN rooms r ON r.id = c.call_room_id
       WHERE cm.user_id = ? AND cm.removed_at IS NULL AND r.kind = 'voice'
       ORDER BY c.is_default DESC, r.name`,
    )
    .bind(userId)
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
