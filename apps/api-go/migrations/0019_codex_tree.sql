-- Codex entries nest (house decision #69): any entry may sit under one of its own kind, a scene still under an adventure.
-- The kind and depth rules need the parent row, so codex.move checks them inside the campaign's queue; the table only
-- keeps an entry from being its own parent.
ALTER TABLE codex_entry DROP CONSTRAINT codex_entry_parent_check;
ALTER TABLE codex_entry ADD CONSTRAINT codex_entry_parent_check CHECK (parent_id IS NULL OR parent_id <> id);
