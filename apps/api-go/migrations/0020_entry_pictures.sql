-- A picture on a codex entry (docs/adr/0012, decision 5; house decision #70): small, the room's, needed for the
-- session, so its bytes are a bytea here, behind internal/image's Store, never jsonb and never in a snapshot.
CREATE TABLE image (
	id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	campaign_id uuid NOT NULL REFERENCES campaign(id) ON DELETE CASCADE,
	mime text NOT NULL,
	bytes bytea NOT NULL,
	size integer NOT NULL,
	created_by text,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX image_campaign_id_index ON image (campaign_id);

-- Whether the table sees the picture is apart from whether it sees the entry.
ALTER TABLE codex_entry ADD COLUMN image_id uuid REFERENCES image(id) ON DELETE SET NULL;
ALTER TABLE codex_entry ADD COLUMN image_revealed boolean NOT NULL DEFAULT false;
CREATE INDEX codex_entry_image_id_index ON codex_entry (image_id) WHERE image_id IS NOT NULL;
