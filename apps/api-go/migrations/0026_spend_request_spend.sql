-- A request may name a spend of the room's ruleset and the numbers its asker picked, in place of a resource and an
-- amount (house decision #84). Exactly one of the two forms.
ALTER TABLE spend_request
	ALTER COLUMN resource_id DROP NOT NULL,
	ALTER COLUMN amount DROP NOT NULL,
	ADD COLUMN spend_id text CHECK (char_length(spend_id) BETWEEN 1 AND 64),
	ADD COLUMN inputs jsonb,
	ADD CONSTRAINT spend_request_form CHECK (
		(spend_id IS NULL AND inputs IS NULL AND resource_id IS NOT NULL AND amount IS NOT NULL)
		OR (spend_id IS NOT NULL AND resource_id IS NULL AND amount IS NULL)
	);
