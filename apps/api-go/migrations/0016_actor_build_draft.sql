-- An unfinished ledger build the GM can open (house decision #63): a row may hold a draft and no build yet. A ready save
-- writes the build and its sheet and clears the draft; a draft save writes the draft only. `json` for the reason 0014
-- gives.
ALTER TABLE actor_build
	ALTER COLUMN build DROP NOT NULL,
	ALTER COLUMN sheet DROP NOT NULL,
	ADD COLUMN draft json,
	ADD CONSTRAINT actor_build_sheet_with_build CHECK ((build IS NULL) = (sheet IS NULL));
