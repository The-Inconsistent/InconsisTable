// Package migrations holds the schema as SQL files, built into the binary and applied at boot in name order
// (core.RunMigrations). A schema change is a new file written by hand, numbered after the last: NNNN_what_it_does.sql.
// A file that has been applied anywhere is never edited. Statements in a file may be split by "--> statement-breakpoint"
// (the files Drizzle wrote) or not; each file runs in the boot's one transaction.
package migrations

import "embed"

// FS is every migration file.
//
//go:embed *.sql
var FS embed.FS

// Drizzle names the files Drizzle wrote, by the journal time its migrator recorded in drizzle.__drizzle_migrations, so a
// database Drizzle migrated counts them as applied. It never grows: files after these are recorded by name only.
var Drizzle = map[string]int64{
	"0000_serious_maddog.sql":       1792136267466,
	"0001_heavy_jimmy_woo.sql":      1793197049082,
	"0002_white_madelyne_pryor.sql": 1793218760905,
	"0003_shallow_thor_girl.sql":    1793241974668,
	"0004_tranquil_mephisto.sql":    1793243592473,
}
