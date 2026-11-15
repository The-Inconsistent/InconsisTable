-- Session Zero (docs/p2-plan.md group E): the table's lines, veils and the X-Card's switch, a small document read and
-- written whole (CLAUDE.md, data rules). A suggestion is appended without an author, so nothing here says who asked.
ALTER TABLE campaign ADD COLUMN safety jsonb NOT NULL DEFAULT '{"lines":[],"veils":[],"xCard":true}'::jsonb;
