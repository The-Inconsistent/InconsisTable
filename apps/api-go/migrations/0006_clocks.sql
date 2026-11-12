-- Clocks: segmented progress clocks the GM fills and empties during play (docs/p2-plan.md group C, design §3.4).
-- A column table, not JSONB: a clock is counted by delta and filtered by visibility.
CREATE TABLE clock (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	campaign_id uuid NOT NULL REFERENCES campaign (id) ON DELETE CASCADE,
	name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
	segments integer NOT NULL CHECK (segments BETWEEN 2 AND 12),
	filled integer NOT NULL DEFAULT 0,
	visibility text NOT NULL DEFAULT 'gm' CHECK (visibility IN ('gm', 'party')),
	entry_id uuid REFERENCES codex_entry (id) ON DELETE SET NULL,
	position integer NOT NULL,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT clock_filled_in_range CHECK (filled BETWEEN 0 AND segments)
);
CREATE INDEX clock_campaign_id_position_index ON clock (campaign_id, position);
