PRAGMA defer_foreign_keys = ON;

CREATE TABLE users_next (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations >= 100000),
  password_version INTEGER NOT NULL DEFAULT 1 CHECK (password_version >= 1),
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  password_changed_at TEXT NOT NULL,
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  login_not_before TEXT,
  CHECK (length(username) BETWEEN 3 AND 24),
  CHECK (username = lower(username)),
  CHECK (username NOT GLOB '*[^a-z0-9._-]*'),
  CHECK (length(display_name) BETWEEN 1 AND 40)
);

INSERT INTO users_next (
  id,
  username,
  display_name,
  password_hash,
  password_salt,
  password_iterations,
  password_version,
  role,
  status,
  created_at,
  updated_at,
  password_changed_at,
  last_login_at,
  failed_login_count,
  login_not_before
)
SELECT
  id,
  username,
  display_name,
  password_hash,
  password_salt,
  password_iterations,
  password_version,
  role,
  status,
  created_at,
  updated_at,
  password_changed_at,
  last_login_at,
  failed_login_count,
  login_not_before
FROM users;

DROP TABLE users;
ALTER TABLE users_next RENAME TO users;

CREATE INDEX idx_users_status ON users(status);
