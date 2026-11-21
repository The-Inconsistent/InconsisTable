-- The uses of spends limited per round (house decision #91), each "<round>:<actorId>:<spendId>": the turn key `used`,
-- written whole by spend.do, so Undo and TURN BACK put it back as they put back the other turn keys.
ALTER TABLE encounter ADD COLUMN used text[] NOT NULL DEFAULT '{}';
