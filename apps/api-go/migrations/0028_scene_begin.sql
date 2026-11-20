-- When an entry was last revealed to the party or to a reader (house decision #86): set by a reveal, cleared when it is
-- sealed again. Entries revealed before this file have no time.
ALTER TABLE codex_entry ADD COLUMN revealed_at timestamptz;

-- A scene begun (scene.begin, house decision #86): what scene.undoBegin needs to take it back. The scene that was
-- active (null when none, or once deleted), the begun scene's status before, and the entries the begin itself revealed
-- (sealed before it). A table, since the latest of the room is looked up; the session log is written only in a session.
CREATE TABLE scene_begin (
	id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	campaign_id uuid NOT NULL REFERENCES campaign (id) ON DELETE CASCADE,
	scene_id uuid NOT NULL REFERENCES codex_entry (id) ON DELETE CASCADE,
	before_id uuid REFERENCES codex_entry (id) ON DELETE SET NULL,
	scene_status text NOT NULL,
	revealed uuid[] NOT NULL DEFAULT '{}',
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scene_begin_latest ON scene_begin (campaign_id, created_at DESC, id DESC);
