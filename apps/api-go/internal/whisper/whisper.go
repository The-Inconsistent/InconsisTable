// Package whisper holds whispers (house decision #93): the GM's private line to chosen characters, one reply of up to
// 200 characters per reader (a new reply replaces it), a read mark per reader, cleared when a session starts or ends.
// Kept from Auspex (whisper.actions.ts, rules-flow §11.164). Only in a room with a GM: without one, every action is
// refused with whispersNeedGm. Whispers are not logged, so they are in no recap and no player's log.
package whisper

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Load is the room's whispers, newest first, each with every reader. The Seat view decides what each seat gets.
func Load(ctx context.Context, conn core.Conn, campaignID string) ([]cs.Whisper, error) {
	rows, err := conn.Query(ctx, `SELECT w.id::text, w.text, w.created_at,
			r.actor_id::text, r.reply, r.replied_at, r.read_at
		FROM whisper w LEFT JOIN whisper_reader r ON r.whisper_id = w.id
		WHERE w.campaign_id = $1 ORDER BY w.created_at DESC, w.id DESC, r.actor_id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []cs.Whisper{}
	for rows.Next() {
		var id, text string
		var at time.Time
		var actorID, reply *string
		var repliedAt, readAt *time.Time
		if err := rows.Scan(&id, &text, &at, &actorID, &reply, &repliedAt, &readAt); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].ID != id {
			out = append(out, cs.Whisper{ID: id, Text: text, CreatedAt: core.ISOTime(at), Readers: []cs.WhisperReader{}})
		}
		if actorID != nil {
			w := &out[len(out)-1]
			w.Readers = append(w.Readers, cs.WhisperReader{ActorID: *actorID, Reply: reply, RepliedAt: iso(repliedAt), ReadAt: iso(readAt)})
		}
	}
	return out, rows.Err()
}

func iso(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := core.ISOTime(*t)
	return &s
}

// Clear deletes every whisper of the room: a session started or ended (Auspex whisper.clear.ts).
func Clear(ctx context.Context, tx core.Conn, campaignID string) error {
	_, err := tx.Exec(ctx, `DELETE FROM whisper WHERE campaign_id = $1`, campaignID)
	return err
}

// Send is whisper.send: one line to one or more of the party's characters, at most cs.MaxWhispers in the room.
func Send(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if !c.HasGM() {
		return cs.Result{}, cs.Fail("whispersNeedGm")
	}
	to, _ := a["to"].([]any)
	ids := make([]string, 0, len(to))
	for _, x := range to {
		s, _ := x.(string)
		ids = append(ids, s)
	}
	var party int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM actor WHERE campaign_id = $1 AND id = ANY($2::uuid[]) AND kind IN ('pc', 'companion')`,
		c.CampaignID, ids).Scan(&party); err != nil {
		return cs.Result{}, err
	}
	if party != len(ids) {
		return cs.Result{}, cs.Fail("whisperRecipient")
	}
	var held int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM whisper WHERE campaign_id = $1`, c.CampaignID).Scan(&held); err != nil {
		return cs.Result{}, err
	}
	if held >= cs.MaxWhispers {
		return cs.Result{}, cs.Fail("whisperLimit", cs.Params{"max": cs.MaxWhispers})
	}
	var id string
	if err := tx.QueryRow(ctx, `INSERT INTO whisper (campaign_id, text) VALUES ($1, $2) RETURNING id::text`,
		c.CampaignID, a.Str("text")).Scan(&id); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `INSERT INTO whisper_reader (whisper_id, actor_id) SELECT $1, unnest($2::uuid[])`, id, ids)
	return cs.Done(id), err
}

// reader refuses a whisper that is gone, or one not to this character; the permission has checked the seat holds it.
func reader(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) error {
	if !c.HasGM() {
		return cs.Fail("whispersNeedGm")
	}
	var addressed bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM whisper_reader WHERE whisper_id = w.id AND actor_id = $3)
		FROM whisper w WHERE w.id = $1 AND w.campaign_id = $2`, a.Str("whisperId"), c.CampaignID, a.Str("actorId")).Scan(&addressed)
	if errors.Is(err, pgx.ErrNoRows) {
		return cs.Fail("whisperGone")
	}
	if err != nil {
		return err
	}
	if !addressed {
		return cs.Fail("whisperNotToThem")
	}
	return nil
}

// Reply is whisper.reply: the reader's one reply, which a new one replaces (Auspex whisper.actions.ts). Replying reads it.
func Reply(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if err := reader(ctx, tx, c, a); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `UPDATE whisper_reader SET reply = $3, replied_at = now(), read_at = coalesce(read_at, now())
		WHERE whisper_id = $1 AND actor_id = $2`, a.Str("whisperId"), a.Str("actorId"), a.Str("text"))
	return cs.Done(a.Str("whisperId")), err
}

// Read is whisper.read: the reader has seen it. The first read stands.
func Read(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if err := reader(ctx, tx, c, a); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `UPDATE whisper_reader SET read_at = coalesce(read_at, now()) WHERE whisper_id = $1 AND actor_id = $2`,
		a.Str("whisperId"), a.Str("actorId"))
	return cs.Done(a.Str("whisperId")), err
}

// Delete is whisper.delete: the GM takes a whisper back. One already gone is no refusal (Auspex whisper.actions.ts).
func Delete(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if !c.HasGM() {
		return cs.Result{}, cs.Fail("whispersNeedGm")
	}
	_, err := tx.Exec(ctx, `DELETE FROM whisper WHERE id = $1 AND campaign_id = $2`, a.Str("id"), c.CampaignID)
	return cs.Done(""), err
}
