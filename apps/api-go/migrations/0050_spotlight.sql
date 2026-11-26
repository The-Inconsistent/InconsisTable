-- SHOW TO TABLE (#2, house decision #139): the one codex entry the GM is holding up to the table, at most one per room.
-- `listed` says it was shown to chosen characters, who are rows (filtered by the seat that holds them, and a reader goes
-- with its character); a listed spotlight whose readers are all gone shows to no one. It goes with its entry.
CREATE TABLE spotlight (
	campaign_id uuid PRIMARY KEY REFERENCES campaign (id) ON DELETE CASCADE,
	entry_id uuid NOT NULL REFERENCES codex_entry (id) ON DELETE CASCADE,
	listed boolean NOT NULL,
	at timestamp with time zone NOT NULL
);
CREATE INDEX spotlight_entry_id_index ON spotlight (entry_id);

CREATE TABLE spotlight_reader (
	campaign_id uuid NOT NULL REFERENCES spotlight (campaign_id) ON DELETE CASCADE,
	actor_id uuid NOT NULL REFERENCES actor (id) ON DELETE CASCADE,
	PRIMARY KEY (campaign_id, actor_id)
);
CREATE INDEX spotlight_reader_actor_id_index ON spotlight_reader (actor_id);
