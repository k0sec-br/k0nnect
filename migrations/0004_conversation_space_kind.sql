ALTER TABLE conversations
ADD COLUMN space_kind TEXT CHECK (space_kind IN ('community', 'group'));

UPDATE conversations
SET space_kind = CASE WHEN is_default = 1 THEN 'community' ELSE 'group' END
WHERE kind = 'group';

CREATE TRIGGER conversations_require_space_kind
BEFORE INSERT ON conversations
BEGIN
  SELECT RAISE(ABORT, 'invalid conversation space kind')
  WHERE (NEW.kind = 'dm' AND NEW.space_kind IS NOT NULL)
     OR (NEW.kind = 'group' AND NEW.space_kind IS NULL);

  SELECT RAISE(ABORT, 'community creation denied')
  WHERE NEW.space_kind = 'community' AND NEW.id <> 'group_k0sec';
END;

CREATE TRIGGER conversations_protect_space_kind
BEFORE UPDATE OF kind, space_kind ON conversations
BEGIN
  SELECT RAISE(ABORT, 'invalid conversation space kind')
  WHERE (NEW.kind = 'dm' AND NEW.space_kind IS NOT NULL)
     OR (NEW.kind = 'group' AND NEW.space_kind IS NULL);

  SELECT RAISE(ABORT, 'community mutation denied')
  WHERE NEW.space_kind = 'community' AND NEW.id <> 'group_k0sec';
END;
