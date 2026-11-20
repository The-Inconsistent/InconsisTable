-- A handout's layout and header line (house decision #72): one of the platform's layouts, and a line drawn above the
-- body. A handout always has both; every other kind has neither, as only a quest has a status.
ALTER TABLE codex_entry ADD COLUMN layout text;
ALTER TABLE codex_entry ADD COLUMN header text;
UPDATE codex_entry SET layout = 'plain', header = '' WHERE kind = 'handout';
ALTER TABLE codex_entry ADD CONSTRAINT codex_entry_layout_check CHECK (
	(kind = 'handout' AND layout IN ('plain', 'tablet', 'form', 'transcript', 'proclamation') AND header IS NOT NULL
		AND char_length(header) <= 120)
	OR (kind <> 'handout' AND layout IS NULL AND header IS NULL)
);
