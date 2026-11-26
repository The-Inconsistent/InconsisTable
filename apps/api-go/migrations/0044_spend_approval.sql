-- The logged action that approved a request (#227, house decision #119). Undo of that action puts the request back to
-- pending, so the GM side can answer it again, as an applied offer becomes applicable again (house decision #80). Null
-- for a request not approved, an acquisition (its approval is a Test call, not a logged action), a spend that changed
-- nothing, and one approved before this column.
ALTER TABLE spend_request ADD COLUMN action_id uuid;
CREATE INDEX spend_request_action_id_index ON spend_request (action_id) WHERE action_id IS NOT NULL;
