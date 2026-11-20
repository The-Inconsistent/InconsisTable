-- A ledger character in play (house decision #64): what its saved build's advancement spends of the XP earned, the XP it
-- had when the group last Ascended (or the Tier was raised), and whether that Ascension waived its package. An actor
-- the Ascension writes to before it has a build gets a row with no documents.
ALTER TABLE actor_build
	ADD COLUMN xp_spent integer NOT NULL DEFAULT 0,
	ADD COLUMN xp_at_ascension integer NOT NULL DEFAULT 0,
	ADD COLUMN package_waived boolean NOT NULL DEFAULT false;
