-- A scene's prepared lines and its status (ADR 0012 decision 3, house decision #73). The lines are one small document
-- read and written whole, so jsonb; the status is the existing column, widened for scenes, with at most one scene of a
-- room active.
ALTER TABLE codex_entry ADD COLUMN prep jsonb;
ALTER TABLE codex_entry ADD CONSTRAINT codex_entry_prep_check CHECK (prep IS NULL OR kind = 'scene');

UPDATE codex_entry SET status = 'planned' WHERE kind = 'scene';
ALTER TABLE codex_entry DROP CONSTRAINT codex_entry_status_check;
ALTER TABLE codex_entry ADD CONSTRAINT codex_entry_status_check CHECK (
	(kind = 'quest' AND status IN ('open', 'done', 'failed'))
	OR (kind = 'scene' AND status IN ('planned', 'active', 'done', 'skipped'))
	OR (kind NOT IN ('quest', 'scene') AND status IS NULL)
);
CREATE UNIQUE INDEX codex_entry_one_active_scene ON codex_entry (campaign_id) WHERE kind = 'scene' AND status = 'active';
