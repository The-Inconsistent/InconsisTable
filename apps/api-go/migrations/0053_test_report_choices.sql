-- What a Test's taker chose while reporting (#227, house decision #170): every choice the Test declares, by id, as a
-- switch or a whole number. Read whole with the report; NULL on a report of a Test without choices.
ALTER TABLE test_report ADD COLUMN choices jsonb;
