// Package core holds what every feature of the api leans on: the database, HTTP helpers, CSRF and rate limits.
package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Open connects to Postgres 18 (uuidv7, RETURNING OLD/NEW).
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, url)
}

// InTx runs fn in one transaction, committing when it returns nil.
func InTx(ctx context.Context, db *pgxpool.Pool, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, db, fn)
}

type migrationEntry struct {
	When int64  `json:"when"`
	Tag  string `json:"tag"`
}

// RunMigrations applies the SQL files Drizzle generated, in the journal's order, and records them the way Drizzle's
// migrator does, so the TypeScript api and this one read the same record while both exist.
//
// ponytail: reads the folder at boot from apps/api/drizzle; embed the files once they move to apps/api-go at the flip.
func RunMigrations(ctx context.Context, db *pgxpool.Pool, folder string) error {
	// pack_entry's name index uses pg_trgm. Enabled here, not in a migration file, so regenerating the migration from
	// scratch can't lose it. A trusted extension: the database owner may create it.
	if _, err := db.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS pg_trgm`); err != nil {
		return err
	}
	raw, err := os.ReadFile(filepath.Join(folder, "meta", "_journal.json"))
	if err != nil {
		return err
	}
	var journal struct {
		Entries []migrationEntry `json:"entries"`
	}
	if err := json.Unmarshal(raw, &journal); err != nil {
		return err
	}
	return InTx(ctx, db, func(tx pgx.Tx) error {
		for _, statement := range []string{
			`CREATE SCHEMA IF NOT EXISTS "drizzle"`,
			`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
		} {
			if _, err := tx.Exec(ctx, statement); err != nil {
				return err
			}
		}
		var last int64
		err := tx.QueryRow(ctx, `SELECT coalesce(max(created_at), 0) FROM "drizzle"."__drizzle_migrations"`).Scan(&last)
		if err != nil {
			return err
		}
		for _, entry := range journal.Entries {
			if entry.When <= last {
				continue
			}
			file, err := os.ReadFile(filepath.Join(folder, entry.Tag+".sql"))
			if err != nil {
				return err
			}
			for _, statement := range strings.Split(string(file), "--> statement-breakpoint") {
				if _, err := tx.Exec(ctx, statement); err != nil {
					return fmt.Errorf("migration %s: %w", entry.Tag, err)
				}
			}
			sum := sha256.Sum256(file)
			if _, err := tx.Exec(ctx, `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
				hex.EncodeToString(sum[:]), entry.When); err != nil {
				return err
			}
		}
		return nil
	})
}
