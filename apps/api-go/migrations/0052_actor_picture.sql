-- A picture on an actor (docs/adr/0012, decisions 1 and 5; house decision #155): one per actor, in the room's picture
-- store beside the entries' (0020), with its own switch for whether the table sees it.
ALTER TABLE actor ADD COLUMN image_id uuid REFERENCES image(id) ON DELETE SET NULL;
ALTER TABLE actor ADD COLUMN image_revealed boolean NOT NULL DEFAULT false;
CREATE INDEX actor_image_id_index ON actor (image_id) WHERE image_id IS NOT NULL;
