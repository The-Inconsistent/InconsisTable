-- Dealing without replacement from a random table (docs/p2-plan.md group F, house decision #49). One row is one card a
-- character holds; a reshuffle deletes the table's rows. A column table, not JSONB: it is filtered by table and counted
-- against the deck. A character holds at most one card from a table. Rolls are session_event rows of their own type.
CREATE TABLE table_deal (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	campaign_id uuid NOT NULL REFERENCES campaign (id) ON DELETE CASCADE,
	table_id text NOT NULL,
	actor_id uuid NOT NULL REFERENCES actor (id) ON DELETE CASCADE,
	entry_id text NOT NULL,
	dealt_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT table_deal_one_card_per_actor UNIQUE (campaign_id, table_id, actor_id)
);
