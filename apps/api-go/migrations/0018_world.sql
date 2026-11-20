-- A World (docs/adr/0010-game-modules.md, decision 2; house decision #65): the look of one setting, imported by its
-- owner beside the rulesets and packs, in immutable versions a room pins. The document is read and written whole, so
-- jsonb (its hash is of the canonical text, so the key order jsonb keeps does not matter); what is filtered, counted or
-- referenced is a column.
CREATE TABLE world (
	id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	owner_user_id text NOT NULL,
	slug text NOT NULL,
	hidden_at timestamptz,
	disabled_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT world_owner_user_id_slug_unique UNIQUE (owner_user_id, slug)
);

CREATE TABLE world_version (
	id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	world_id uuid NOT NULL REFERENCES world(id) ON DELETE CASCADE,
	version text NOT NULL,
	hash text NOT NULL,
	document jsonb NOT NULL,
	bytes integer NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT world_version_world_id_version_unique UNIQUE (world_id, version)
);
CREATE INDEX world_version_world_id_created_at_index ON world_version (world_id, created_at);

-- A pinned version cannot be deleted from under a room: hiding a World removes it only when no room pins it.
ALTER TABLE campaign ADD COLUMN world_version_id uuid REFERENCES world_version(id) ON DELETE RESTRICT;
CREATE INDEX campaign_world_version_id_index ON campaign (world_version_id) WHERE world_version_id IS NOT NULL;
