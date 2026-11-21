-- House decision #92: the spawn options an actor was spawned with (their effects run with its conditions'), and a
-- combatant's marker colour from the platform's closed list.
ALTER TABLE actor ADD COLUMN spawn_options text[] NOT NULL DEFAULT '{}';
ALTER TABLE combatant ADD COLUMN marker text
	CHECK (marker IN ('red', 'amber', 'green', 'blue', 'purple', 'white'));
