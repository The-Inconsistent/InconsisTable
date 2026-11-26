-- The XP each character was given when the session ended (#220, #233, house decision #120): null for a session
-- abandoned, still running, ended in a ruleset that gives no award, or ended before this column. session.edit never
-- writes it.
ALTER TABLE session ADD COLUMN award integer CHECK (award >= 0);
