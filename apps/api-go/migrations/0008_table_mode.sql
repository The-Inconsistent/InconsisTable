-- How a room sits: with a GM, without one (every player runs the table together), or one player alone (docs/p2-plan.md
-- group D, docs/adr/0009-table-modes.md). A column, not JSONB: the lobby filters by it. Changed only between sessions.
ALTER TABLE campaign ADD COLUMN table_mode text NOT NULL DEFAULT 'gm' CHECK (table_mode IN ('gm', 'gmless', 'solo'));
