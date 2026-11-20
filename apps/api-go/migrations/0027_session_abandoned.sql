-- A session ended without an award (session.abandon, house decision #85): never played, or left open. The GM's journal
-- says so beside it.
ALTER TABLE session ADD COLUMN abandoned boolean NOT NULL DEFAULT false;
