-- The pack entry a codex entry was made from (house decision #97): {entity, key, cite}, read and written whole, never
-- filtered or joined; null for an entry the GM wrote. The cite is read from the served entry when it is set.
ALTER TABLE codex_entry ADD COLUMN source jsonb;
