-- Whispers (house decision #93): the GM's private line to chosen characters, one reply each, cleared when a session
-- starts or ends. The readers are rows, since they are filtered by the seat that holds them and joined to actors; a
-- reader goes with its character.
CREATE TABLE whisper (
	id uuid PRIMARY KEY DEFAULT uuidv7(),
	campaign_id uuid NOT NULL REFERENCES campaign (id) ON DELETE CASCADE,
	text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
	created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX whisper_campaign_id_index ON whisper (campaign_id, created_at);

CREATE TABLE whisper_reader (
	whisper_id uuid NOT NULL REFERENCES whisper (id) ON DELETE CASCADE,
	actor_id uuid NOT NULL REFERENCES actor (id) ON DELETE CASCADE,
	reply text CHECK (char_length(reply) BETWEEN 1 AND 200),
	replied_at timestamp with time zone,
	read_at timestamp with time zone,
	PRIMARY KEY (whisper_id, actor_id),
	CHECK ((reply IS NULL) = (replied_at IS NULL))
);
CREATE INDEX whisper_reader_actor_id_index ON whisper_reader (actor_id);
