-- Spend requests: a player asks to spend from a resource, the GM approves or denies (docs/p2-plan.md group C, house
-- decision #43). Approval applies the spend through the resource delta path, so the request row only keeps the ask and
-- its answer. actor_id is NULL for a shared pool (not at the table yet).
CREATE TABLE spend_request (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	campaign_id uuid NOT NULL REFERENCES campaign (id) ON DELETE CASCADE,
	user_id text NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
	actor_id uuid REFERENCES actor (id) ON DELETE CASCADE,
	resource_id text NOT NULL,
	amount integer NOT NULL CHECK (amount BETWEEN 1 AND 99),
	note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 140),
	status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
	reason text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 140),
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	resolved_at timestamp with time zone
);
CREATE INDEX spend_request_campaign_id_status_index ON spend_request (campaign_id, status, created_at);
