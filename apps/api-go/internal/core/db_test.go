package core

import (
	"context"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/migrations"
)

// A scratch database on the server TEST_DATABASE_URL names, dropped after the test.
func scratchDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	server, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(server.Close)
	name := "it_migrate_" + strings.ReplaceAll(NewUUID(), "-", "")
	if _, err := server.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.Database = name
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, _ = server.Exec(context.Background(), `DROP DATABASE `+name+` WITH (FORCE)`)
	})
	return db
}

// A database Drizzle migrated (all, some or none of its files) boots without running a recorded file again: running one
// again would fail on a table that already exists.
func TestADatabaseDrizzleMigratedRunsOnlyWhatItsRecordLacks(t *testing.T) {
	ctx := context.Background()
	drizzled := slices.Sorted(maps.Keys(migrations.Drizzle))
	files, err := fs.Glob(migrations.FS, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, applied := range []int{len(drizzled), len(drizzled) - 1, 0} {
		t.Run(fmt.Sprintf("%d by Drizzle", applied), func(t *testing.T) {
			db := scratchDB(t)
			// What Drizzle's migrator leaves: the files run, and its record of them by journal time.
			exec := func(sql string, args ...any) {
				t.Helper()
				if _, err := db.Exec(ctx, sql, args...); err != nil {
					t.Fatalf("%.60s: %v", sql, err)
				}
			}
			// None by Drizzle is a fresh database: no record at all.
			if applied > 0 {
				exec(`CREATE EXTENSION IF NOT EXISTS pg_trgm`)
				exec(`CREATE SCHEMA drizzle`)
				exec(`CREATE TABLE drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`)
			}
			for _, name := range drizzled[:applied] {
				file, err := migrations.FS.ReadFile(name)
				if err != nil {
					t.Fatal(err)
				}
				for _, statement := range strings.Split(string(file), "--> statement-breakpoint") {
					exec(statement)
				}
				exec(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', $1)`, migrations.Drizzle[name])
			}

			for range 2 { // and a second boot finds nothing to run
				if err := RunMigrations(ctx, db); err != nil {
					t.Fatal(err)
				}
			}
			var recorded int
			if err := db.QueryRow(ctx, `SELECT count(*) FROM schema_migration`).Scan(&recorded); err != nil || recorded != len(files) {
				t.Fatalf("want %d files recorded, got %d %v", len(files), recorded, err)
			}
		})
	}
}
