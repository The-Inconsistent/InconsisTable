// Package image holds a room's pictures (docs/adr/0012, decision 5; house decision #70). A picture is small, belongs to
// the room and is needed for the session, so its bytes sit behind Store: an object store can replace the Postgres one
// without a change above it. The limits are Auspex's (wrath_glory packages/shared/src/codex.ts).
package image

import (
	"bytes"
	"context"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

const (
	// MaxBytes is one picture's cap; MaxCount and MaxRoomBytes a room's.
	MaxBytes     = 1_000_000
	MaxCount     = 200
	MaxRoomBytes = 100_000_000
	// Grace is how long an uploaded picture no entry or actor points at is kept before a codex write sweeps it.
	Grace = 24 * time.Hour
)

// Mimes are the two formats a picture may be.
var Mimes = []string{"image/webp", "image/jpeg"}

// Picture is one stored picture.
type Picture struct {
	Mime  string
	Bytes []byte
}

// Info is what a room's quota and sweep need of one picture, without its bytes.
type Info struct {
	ID        string
	Size      int
	CreatedAt time.Time
}

// Store keeps the bytes. Every call is scoped to one room; conn is the caller's transaction or pool.
type Store interface {
	Put(ctx context.Context, conn core.Conn, campaignID string, createdBy *string, mime string, data []byte) (string, error)
	// Get is nil when the room holds no picture by that id.
	Get(ctx context.Context, conn core.Conn, campaignID, id string) (*Picture, error)
	Delete(ctx context.Context, conn core.Conn, campaignID string, ids []string) error
	Usage(ctx context.Context, conn core.Conn, campaignID string) ([]Info, error)
}

// Pictures is the store the api uses.
var Pictures Store = postgres{}

// Sniff is the format the leading bytes say, or "".
func Sniff(b []byte) string {
	switch {
	case len(b) > 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff:
		return "image/jpeg"
	case len(b) > 12 && bytes.Equal(b[0:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP")):
		return "image/webp"
	}
	return ""
}

// Check refuses a picture that is not what it says or does not fit the room beside what it holds.
func Check(mime string, data []byte, held []Info) error {
	if !slices.Contains(Mimes, mime) {
		return cs.Fail("pictureType")
	}
	if Sniff(data) != mime {
		return cs.Fail("pictureNotPicture")
	}
	if len(data) > MaxBytes {
		return cs.Fail("pictureTooLarge")
	}
	if len(held) >= MaxCount {
		return cs.Fail("picturesFull")
	}
	total := len(data)
	for _, p := range held {
		total += p.Size
	}
	if total > MaxRoomBytes {
		return cs.Fail("picturesTooHeavy")
	}
	return nil
}

// Has says whether the room holds a picture by that id.
func Has(ctx context.Context, conn core.Conn, campaignID, id string) (bool, error) {
	held, err := Pictures.Usage(ctx, conn, campaignID)
	return slices.ContainsFunc(held, func(p Info) bool { return p.ID == id }), err
}

// used is the SQL that says a picture is pointed at: by a codex entry (house decision #70) or an actor (#155).
const used = `(EXISTS (SELECT 1 FROM codex_entry WHERE image_id = $1) OR EXISTS (SELECT 1 FROM actor WHERE image_id = $1))`

// Free says whether the room holds the picture and nothing points at it yet: only its uploader has learnt its id.
func Free(ctx context.Context, conn core.Conn, campaignID, id string) (bool, error) {
	var free bool
	err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM image WHERE id = $1 AND campaign_id = $2) AND NOT `+used,
		id, campaignID).Scan(&free)
	return free, err
}

// DropUnused deletes a picture nothing points at any more.
func DropUnused(ctx context.Context, conn core.Conn, campaignID string, id *string) error {
	if id == nil {
		return nil
	}
	var inUse bool
	if err := conn.QueryRow(ctx, `SELECT `+used, *id).Scan(&inUse); err != nil || inUse {
		return err
	}
	return Pictures.Delete(ctx, conn, campaignID, []string{*id})
}

// Unused is which of the ids nothing in the room points at.
func Unused(ctx context.Context, conn core.Conn, campaignID string, ids []string) ([]string, error) {
	rows, err := conn.Query(ctx, `SELECT unnest($1::uuid[])::text EXCEPT (
		SELECT image_id::text FROM codex_entry WHERE campaign_id = $2 AND image_id IS NOT NULL
		UNION SELECT image_id::text FROM actor WHERE campaign_id = $2 AND image_id IS NOT NULL)`, ids, campaignID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

type postgres struct{}

func (postgres) Put(ctx context.Context, conn core.Conn, campaignID string, createdBy *string, mime string, data []byte) (string, error) {
	var id string
	err := conn.QueryRow(ctx, `INSERT INTO image (campaign_id, mime, bytes, size, created_by) VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text`, campaignID, mime, data, len(data), createdBy).Scan(&id)
	return id, err
}

func (postgres) Get(ctx context.Context, conn core.Conn, campaignID, id string) (*Picture, error) {
	var p Picture
	err := conn.QueryRow(ctx, `SELECT mime, bytes FROM image WHERE id = $1 AND campaign_id = $2`, id, campaignID).
		Scan(&p.Mime, &p.Bytes)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (postgres) Delete(ctx context.Context, conn core.Conn, campaignID string, ids []string) error {
	_, err := conn.Exec(ctx, `DELETE FROM image WHERE campaign_id = $1 AND id = ANY($2::uuid[])`, campaignID, ids)
	return err
}

func (postgres) Usage(ctx context.Context, conn core.Conn, campaignID string) ([]Info, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, size, created_at FROM image WHERE campaign_id = $1`, campaignID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Info, error) {
		var p Info
		err := r.Scan(&p.ID, &p.Size, &p.CreatedAt)
		return p, err
	})
}
