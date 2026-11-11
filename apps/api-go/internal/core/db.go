// Package core holds what every feature of the api leans on: the database, HTTP helpers, CSRF and rate limits.
package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io/fs"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/migrations"
)

// Open connects to Postgres 18 (uuidv7, RETURNING OLD/NEW).
func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, url)
}

// NewUUID is a random (version 4) UUID, for ids the api makes before a row exists: crypto.randomUUID in TypeScript.
func NewUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:]) // never fails (crypto/rand)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// Conn is what reads and writes need of a pool or a transaction, so one loader serves both.
type Conn interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// InTx runs fn in one transaction, committing when it returns nil.
func InTx(ctx context.Context, db *pgxpool.Pool, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, db, fn)
}

// RunMigrations applies the files of the migrations package that this database has not recorded, in name order, in
// one transaction, and records each in schema_migration. A database Drizzle migrated (the TypeScript api's) counts the
// files Drizzle recorded as applied, so it boots without running them again.
func RunMigrations(ctx context.Context, db *pgxpool.Pool) error {
	// pack_entry's name index uses pg_trgm. Enabled here, not in a migration file, so no migration can lose it. A trusted
	// extension: the database owner may create it.
	if _, err := db.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS pg_trgm`); err != nil {
		return err
	}
	files, err := fs.Glob(migrations.FS, "*.sql") // sorted by name
	if err != nil {
		return err
	}
	return InTx(ctx, db, func(tx pgx.Tx) error {
		for _, statement := range []string{
			// Two apis booting at once against one database: the second waits, then finds nothing left to run.
			`SELECT pg_advisory_xact_lock(hashtext('inconsistable.migrations'))`,
			`CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
		} {
			if _, err := tx.Exec(ctx, statement); err != nil {
				return err
			}
		}
		// Postgres resolves every table a statement names before it runs, so the record's existence is its own query.
		var drizzled int64
		var hasRecord bool
		if err := tx.QueryRow(ctx, `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL`).Scan(&hasRecord); err != nil {
			return err
		}
		if hasRecord {
			err := tx.QueryRow(ctx, `SELECT coalesce(max(created_at), 0) FROM drizzle.__drizzle_migrations`).Scan(&drizzled)
			if err != nil {
				return err
			}
		}
		for name, when := range migrations.Drizzle {
			// Drizzle's migrator runs a file only when its journal time is past the last one recorded.
			if when <= drizzled {
				if _, err := tx.Exec(ctx, `INSERT INTO schema_migration (name) VALUES ($1) ON CONFLICT DO NOTHING`, name); err != nil {
					return err
				}
			}
		}
		rows, err := tx.Query(ctx, `SELECT name FROM schema_migration`)
		if err != nil {
			return err
		}
		applied, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, name := range files {
			if slices.Contains(applied, name) {
				continue
			}
			file, err := migrations.FS.ReadFile(name)
			if err != nil {
				return err
			}
			for _, statement := range strings.Split(string(file), "--> statement-breakpoint") {
				if _, err := tx.Exec(ctx, statement); err != nil {
					return fmt.Errorf("migration %s: %w", name, err)
				}
			}
			if _, err := tx.Exec(ctx, `INSERT INTO schema_migration (name) VALUES ($1)`, name); err != nil {
				return err
			}
		}
		return nil
	})
}
