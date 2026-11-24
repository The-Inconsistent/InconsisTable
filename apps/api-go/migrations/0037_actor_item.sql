-- Items an actor holds in play (house decision #95): one row per item, naming a served pack entry by type and key, or
-- hand-written with a name. A table and not a list field, since it is filtered by holder, joined to pack entries and
-- codex entries, and referenced by the item it is fitted to. `rev` comes from a sequence on every write, so a screen
-- that read a row can be refused when the row changed since (EDIT CARRIED), even after an undo put it back.
CREATE SEQUENCE actor_item_rev;

CREATE TABLE actor_item (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	actor_id uuid NOT NULL REFERENCES actor (id) ON DELETE CASCADE,
	kind text NOT NULL,
	entry_type text,
	entry_key text,
	name text NOT NULL DEFAULT '',
	note text NOT NULL DEFAULT '',
	quantity integer,
	fitted_to uuid REFERENCES actor_item (id) ON DELETE SET NULL,
	source text NOT NULL,
	codex_entry_id uuid UNIQUE REFERENCES codex_entry (id) ON DELETE SET NULL,
	ordinal integer NOT NULL,
	rev bigint NOT NULL DEFAULT nextval('actor_item_rev'),
	CONSTRAINT actor_item_entry CHECK ((entry_type IS NULL) = (entry_key IS NULL)),
	CONSTRAINT actor_item_named CHECK (entry_key IS NOT NULL OR name <> ''),
	CONSTRAINT actor_item_source CHECK (source IN ('give', 'hand', 'acquire')),
	CONSTRAINT actor_item_quantity CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 999)
);

CREATE INDEX actor_item_actor_id_index ON actor_item (actor_id);
CREATE INDEX actor_item_fitted_to_index ON actor_item (fitted_to) WHERE fitted_to IS NOT NULL;
