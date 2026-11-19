-- What an actor that chose the entry gets in its numbers (house decision #61): a document read and written whole.
ALTER TABLE pack_entry ADD COLUMN effects jsonb NOT NULL DEFAULT '[]';
