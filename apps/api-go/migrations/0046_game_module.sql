-- A game module (docs/adr/0010-game-modules.md, decision 4; house decisions #122 to #125): the list of an owner's parts
-- that makes one game, in immutable versions with a hash, as a World's are (0018_world.sql). The document, without the
-- documents a file carried, is read and written whole, so jsonb; its parts are joined, so they are foreign keys, and
-- RESTRICT keeps a named version from being deleted from under a module. A room pins the parts, never the module, and
-- does not remember it (house decision #124), so deleting a module never has to wait for a room.
CREATE TABLE game_module (
	id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	owner_user_id text NOT NULL,
	slug text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT game_module_owner_user_id_slug_unique UNIQUE (owner_user_id, slug)
);

CREATE TABLE game_module_version (
	id uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	module_id uuid NOT NULL REFERENCES game_module(id) ON DELETE CASCADE,
	version text NOT NULL,
	hash text NOT NULL,
	document jsonb NOT NULL,
	ruleset_version_id uuid NOT NULL REFERENCES ruleset_version(id) ON DELETE RESTRICT,
	world_version_id uuid REFERENCES world_version(id) ON DELETE RESTRICT,
	created_at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT game_module_version_module_id_version_unique UNIQUE (module_id, version)
);
CREATE INDEX game_module_version_module_id_created_at_index ON game_module_version (module_id, created_at);
CREATE INDEX game_module_version_world_version_id_index ON game_module_version (world_version_id)
	WHERE world_version_id IS NOT NULL;

-- The packs a version names, in the module's order.
CREATE TABLE game_module_pack (
	module_version_id uuid NOT NULL REFERENCES game_module_version(id) ON DELETE CASCADE,
	position integer NOT NULL,
	pack_version_id uuid NOT NULL REFERENCES pack_version(id) ON DELETE RESTRICT,
	PRIMARY KEY (module_version_id, position)
);
CREATE INDEX game_module_pack_pack_version_id_index ON game_module_pack (pack_version_id);
