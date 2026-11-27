-- The order a pack file gives its entries, the book's (house decision #201): recorded at import, read by the lists that
-- show pack entries; not part of the pack's hash. Entries imported before take their file order back from their ids
-- (uuidv7, written in the file's order).
ALTER TABLE pack_entry ADD COLUMN ordinal integer NOT NULL DEFAULT 0;

UPDATE pack_entry SET ordinal = ranked.n
FROM (SELECT id, (row_number() OVER (PARTITION BY pack_version_id ORDER BY id) - 1)::integer AS n FROM pack_entry) ranked
WHERE pack_entry.id = ranked.id;
