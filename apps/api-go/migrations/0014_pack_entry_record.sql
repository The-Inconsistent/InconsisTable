-- The ledger builder's catalogue record of an entry (house decision #62), null when it has none. A document read and
-- written whole, but `json`, not `jsonb`: jsonb reorders an object's keys, and the builder reads them in order.
ALTER TABLE pack_entry ADD COLUMN record json;
