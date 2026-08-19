PRAGMA foreign_keys = ON;

CREATE TABLE friendships (
  user_low_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at TEXT NOT NULL,
  responded_at TEXT,
  PRIMARY KEY (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id),
  CHECK (requested_by = user_low_id OR requested_by = user_high_id),
  CHECK ((status = 'pending' AND responded_at IS NULL) OR status = 'accepted')
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
  name TEXT,
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  dm_pair_key TEXT UNIQUE,
  call_room_id TEXT UNIQUE REFERENCES rooms(id) ON DELETE RESTRICT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (kind = 'dm' AND name IS NULL AND owner_user_id IS NULL AND dm_pair_key IS NOT NULL
      AND call_room_id IS NULL AND is_default = 0)
    OR
    (kind = 'group' AND name IS NOT NULL AND length(name) BETWEEN 1 AND 40
      AND dm_pair_key IS NULL AND call_room_id IS NOT NULL)
  ),
  CHECK (is_default = 0 OR (kind = 'group' AND owner_user_id IS NULL))
);

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_role TEXT NOT NULL CHECK (member_role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  removed_at TEXT,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  UNIQUE (sender_id, client_message_id),
  FOREIGN KEY (conversation_id, sender_id)
    REFERENCES conversation_members(conversation_id, user_id) ON DELETE RESTRICT,
  CHECK (length(client_message_id) BETWEEN 1 AND 64),
  CHECK (
    (deleted_at IS NULL AND content IS NOT NULL AND length(content) BETWEEN 1 AND 2000)
    OR (deleted_at IS NOT NULL AND content IS NULL)
  )
);

CREATE INDEX idx_friendships_low_status ON friendships(user_low_id, status, created_at DESC);
CREATE INDEX idx_friendships_high_status ON friendships(user_high_id, status, created_at DESC);
CREATE INDEX idx_conversation_members_user ON conversation_members(user_id, joined_at DESC);
CREATE INDEX idx_conversations_kind_updated ON conversations(kind, updated_at DESC);
CREATE INDEX idx_messages_history ON messages(conversation_id, id DESC);

CREATE TRIGGER messages_require_active_membership
BEFORE INSERT ON messages
BEGIN
  SELECT RAISE(ABORT, 'conversation access denied')
  WHERE NOT EXISTS (
    SELECT 1 FROM conversation_members
    WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id AND removed_at IS NULL
  );
END;

CREATE TRIGGER dm_messages_require_friendship
BEFORE INSERT ON messages
WHEN EXISTS (
  SELECT 1 FROM conversations
  WHERE id = NEW.conversation_id AND kind = 'dm'
)
BEGIN
  SELECT RAISE(ABORT, 'friendship required')
  WHERE NOT EXISTS (
    SELECT 1
    FROM conversation_members peer
    JOIN friendships friendship
      ON friendship.user_low_id = MIN(NEW.sender_id, peer.user_id)
     AND friendship.user_high_id = MAX(NEW.sender_id, peer.user_id)
     AND friendship.status = 'accepted'
    WHERE peer.conversation_id = NEW.conversation_id
      AND peer.user_id <> NEW.sender_id
      AND peer.removed_at IS NULL
  );
END;

INSERT INTO conversations (
  id, kind, name, owner_user_id, dm_pair_key, call_room_id, is_default, created_at, updated_at
) VALUES (
  'group_k0sec', 'group', 'K0Sec', NULL, NULL, 'room_general', 1,
  '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'
);

INSERT INTO conversation_members (conversation_id, user_id, member_role, joined_at)
SELECT 'group_k0sec', id, 'member', created_at FROM users WHERE status = 'active';
