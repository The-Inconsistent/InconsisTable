-- The value of a campaign field a ruleset declares (house decision #58). No row until the value is set; a read then
-- gives the manifest's default. An int is int_value, a bool is int_value 1 or 0, an enum is text_value.
CREATE TABLE campaign_field (
  campaign_id uuid NOT NULL REFERENCES campaign (id) ON DELETE CASCADE,
  field_id text NOT NULL,
  int_value integer,
  text_value text,
  PRIMARY KEY (campaign_id, field_id),
  CONSTRAINT campaign_field_one_value CHECK (num_nonnulls(int_value, text_value) = 1)
);
