-- An offer of a called Test's result, applied for one taker (house decision #80): at most once, until Undo takes back
-- the writes it logged under action_id. action_id is NULL when those writes changed nothing, so nothing takes it back.
-- A table and not the session log's jsonb, since it is looked up by call, taker and offer.
CREATE TABLE test_offer (
	call_id uuid NOT NULL,
	actor_id uuid NOT NULL,
	offer_id text NOT NULL,
	action_id uuid,
	applied_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (call_id, actor_id, offer_id),
	FOREIGN KEY (call_id, actor_id) REFERENCES test_report (call_id, actor_id) ON DELETE CASCADE
);
