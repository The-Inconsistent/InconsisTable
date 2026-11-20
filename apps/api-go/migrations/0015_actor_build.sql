-- A character's saved ledger build and the sheet it resolved to (house decision #63): one row per actor, replaced on
-- each save. Documents read and written whole, but `json`, not `jsonb`, for the reason 0014 gives: jsonb reorders an
-- object's keys, and the builder reads them in order.
CREATE TABLE actor_build (
	actor_id uuid PRIMARY KEY REFERENCES actor(id) ON DELETE CASCADE,
	build json NOT NULL,
	sheet json NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);
