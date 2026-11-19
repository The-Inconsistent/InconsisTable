-- The sides turn order (`initiative.sides`, house decisions #57 and #60). A fight with a setup opens not begun; the side
-- that acted last and the side acting out of turn are side ids of the manifest. A member held back an action or barred
-- from this round is a flag on its combatant row, like `done`. `combatant.side` already exists as text: with a sides
-- ruleset it holds a side id of the manifest.
ALTER TABLE encounter ADD COLUMN begun boolean NOT NULL DEFAULT true;
ALTER TABLE encounter ADD COLUMN last_side text;
ALTER TABLE encounter ADD COLUMN out_of_turn_side text;
ALTER TABLE combatant ADD COLUMN held boolean NOT NULL DEFAULT false;
ALTER TABLE combatant ADD COLUMN barred boolean NOT NULL DEFAULT false;
