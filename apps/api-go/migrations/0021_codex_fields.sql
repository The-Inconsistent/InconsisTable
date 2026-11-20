-- The ruleset's declared fields of a codex entry (ADR 0012 decision 2, house decision #71): a small document read and
-- written whole, validated against the manifest on every write and filtered per seat on every read. Nothing filters,
-- joins or counts by it, so jsonb.
ALTER TABLE codex_entry ADD COLUMN fields jsonb NOT NULL DEFAULT '{}';
