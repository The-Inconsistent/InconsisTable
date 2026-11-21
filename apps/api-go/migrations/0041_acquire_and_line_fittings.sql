-- Acquiring an item by a Test, and fitting onto what a saved build gives (house decision #102).
--
-- A request may ask to acquire a served pack entry (its type and key), with the item or build line it is to be fitted
-- to (`to:<item id>` or `line:<card>/<name>`); its picks ride in `inputs`. Exactly one of the three forms.
ALTER TABLE spend_request
	ADD COLUMN acquire_type text CHECK (char_length(acquire_type) BETWEEN 1 AND 64),
	ADD COLUMN acquire_key text CHECK (char_length(acquire_key) BETWEEN 1 AND 80),
	ADD COLUMN acquire_host text CHECK (char_length(acquire_host) BETWEEN 1 AND 140),
	DROP CONSTRAINT spend_request_form,
	ADD CONSTRAINT spend_request_form CHECK (
		(spend_id IS NULL AND acquire_key IS NULL AND inputs IS NULL AND resource_id IS NOT NULL AND amount IS NOT NULL)
		OR (spend_id IS NOT NULL AND acquire_key IS NULL AND resource_id IS NULL AND amount IS NULL)
		OR (acquire_key IS NOT NULL AND acquire_type IS NOT NULL AND spend_id IS NULL AND resource_id IS NULL AND amount IS NULL)
	);

-- A call made for an acquisition: the kind it grants, counted per actor in a session against the ruleset's limits (so
-- the count is free again when a new session starts), and what a pass grants, worked out when it was called and read
-- whole when it is granted.
ALTER TABLE test_call
	ADD COLUMN acquire_kind text CHECK (char_length(acquire_kind) BETWEEN 1 AND 64),
	ADD COLUMN acquire jsonb,
	ADD CONSTRAINT test_call_acquire CHECK ((acquire_kind IS NULL) = (acquire IS NULL));

CREATE INDEX test_call_acquire_index ON test_call (campaign_id, session_id) WHERE acquire_kind IS NOT NULL;

-- An item fitted to a line of the actor's saved build (`<card>/<name>`, a weapon or the armour), not to an item row.
ALTER TABLE actor_item
	ADD COLUMN fitted_line text CHECK (char_length(fitted_line) BETWEEN 1 AND 130),
	ADD CONSTRAINT actor_item_fitted_one CHECK (fitted_to IS NULL OR fitted_line IS NULL);
