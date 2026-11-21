-- The character library (house decision #104): a user's own characters outside any room, at most 20 each. One row per
-- character: the ruleset version it is built with and the pack versions its catalogue came from, the builder's
-- document as the builder wrote it (`json`, not `jsonb`: the builder reads a build's keys in the order they were
-- written, house decisions #62 and #63, as actor_build keeps it), whether it is done (saved ready) or a draft, and a
-- revision every save checks, so two tabs never overwrite each other.
CREATE TABLE library_character (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	owner_user_id text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
	name text NOT NULL DEFAULT '',
	ruleset_version_id uuid NOT NULL REFERENCES ruleset_version (id) ON DELETE CASCADE,
	pack_version_ids uuid[] NOT NULL DEFAULT '{}',
	build json,
	done boolean NOT NULL DEFAULT false,
	rev bigint NOT NULL DEFAULT 1,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT library_character_done CHECK (NOT done OR build IS NOT NULL)
);

CREATE INDEX library_character_owner_index ON library_character (owner_user_id, updated_at DESC);
