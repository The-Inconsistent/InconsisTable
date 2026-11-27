-- A library card's line (#233, house decision #187): the name of the record a finished character chose of the kind its
-- ruleset names (`build.libraryLine`), kept with the character so the list never reads the packs. Null for a draft, a
-- ruleset that names none, or a character saved before this column.
ALTER TABLE library_character ADD COLUMN line text CHECK (char_length(line) <= 100);
