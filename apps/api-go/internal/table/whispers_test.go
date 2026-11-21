package table

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Whispers (house decision #93): the GM's line to chosen characters, one reply each, cleared each session.

type whisperRoom struct {
	*play
	gm, lyraSeat, branSeat cs.Ctx
	lyra, bran             string
}

func newWhisperRoom(t *testing.T, tx pgx.Tx) whisperRoom {
	p := anyModes(t, tx)
	lyra := p.room.Actor(t, tx, "pc", "Lyra", "")
	bran := p.room.Actor(t, tx, "pc", "Bran", "")
	return whisperRoom{p, p.room.GM(), p.room.Seat(t, tx, dbtest.User(t, tx, "L"), lyra), p.room.Seat(t, tx, dbtest.User(t, tx, "B"), bran), lyra, bran}
}

func (w whisperRoom) whisper(text string, to ...string) string {
	w.t.Helper()
	return w.send(w.gm, map[string]any{"type": "whisper.send", "to": anyIDs(to...), "text": text}).ID
}

func (w whisperRoom) reply(id, actorID, text string) map[string]any {
	return map[string]any{"type": "whisper.reply", "whisperId": id, "actorId": actorID, "text": text}
}

func (w whisperRoom) count() int64 {
	return dbtest.Scalar[int64](w.t, w.tx, `SELECT count(*) FROM whisper WHERE campaign_id = $1`, w.room.ID)
}

func TestAWhisperReachesOnlyItsReadersAndAReplyReplacesTheLast(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		w := newWhisperRoom(t, tx)
		npc := w.room.Actor(t, tx, "npc", "Keeper", "")
		w.refused(w.gm, map[string]any{"type": "whisper.send", "to": anyIDs(npc), "text": "x"}, "whisperRecipient")
		w.refused(w.lyraSeat, map[string]any{"type": "whisper.send", "to": anyIDs(w.lyra), "text": "x"}, "noPermission")

		id := w.whisper(" Both of you ", w.lyra, w.bran)
		only := w.whisper("Just Bran", w.bran)
		if got := w.seatView(w.gm).State.Whispers; len(got) != 2 || got[0].ID != only || len(got[1].Readers) != 2 || got[1].Text != "Both of you" {
			t.Fatalf("the GM sees every whisper, newest first, trimmed: %+v", got)
		}
		mine := w.seatView(w.lyraSeat).State.Whispers
		if len(mine) != 1 || mine[0].ID != id || len(mine[0].Readers) != 1 || mine[0].Readers[0].ActorID != w.lyra {
			t.Fatalf("Lyra's seat gets her whisper with her reader only: %+v", mine)
		}

		// One reply per reader: the second replaces the first; replying reads it.
		w.send(w.lyraSeat, w.reply(id, w.lyra, "First"))
		w.send(w.lyraSeat, w.reply(id, w.lyra, " Second "))
		if r := w.seatView(w.lyraSeat).State.Whispers[0].Readers[0]; r.Reply == nil || *r.Reply != "Second" || r.ReadAt == nil {
			t.Fatalf("the new reply replaces the old and marks it read: %+v", r)
		}
		// Bran's seat never sees Lyra's reply.
		for _, x := range w.seatView(w.branSeat).State.Whispers {
			for _, r := range x.Readers {
				if r.ActorID != w.bran {
					t.Fatalf("Bran's seat sees another reader: %+v", x)
				}
			}
		}
		// The 200-character limit is the schema's; a reply from a seat that holds no addressed character is refused.
		if _, issues := cs.ParseAction(w.reply(id, w.lyra, strings.Repeat("r", 201))); len(issues) == 0 {
			t.Fatal("a reply over 200 characters parses")
		}
		w.send(w.lyraSeat, w.reply(id, w.lyra, strings.Repeat("r", 200)))
		w.refused(w.lyraSeat, w.reply(only, w.bran, "mine now"), "notYourCharacter")
		w.refused(w.lyraSeat, w.reply(only, w.lyra, "me too"), "whisperNotToThem")
		w.refused(w.gm, w.reply(id, w.lyra, "as GM"), "notYourCharacter")

		// Reading marks only that reader.
		w.send(w.branSeat, map[string]any{"type": "whisper.read", "whisperId": only, "actorId": w.bran})
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM whisper_reader WHERE read_at IS NOT NULL`); n != 2 {
			t.Fatalf("%d read marks", n)
		}

		// The GM takes one back; a player may not; one already gone is no refusal.
		w.refused(w.branSeat, map[string]any{"type": "whisper.delete", "id": only}, "noPermission")
		w.send(w.gm, map[string]any{"type": "whisper.delete", "id": only})
		w.send(w.gm, map[string]any{"type": "whisper.delete", "id": only})
		w.refused(w.branSeat, map[string]any{"type": "whisper.read", "whisperId": only, "actorId": w.bran}, "whisperGone")
		if w.count() != 1 {
			t.Fatal("the deleted whisper is gone")
		}
		// Not in the session's log, so in no recap.
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM session_event WHERE campaign_id = $1 AND type LIKE 'whisper%'`, w.room.ID); n != 0 {
			t.Fatalf("%d whisper events logged", n)
		}
	})
}

func TestWhispersAreClearedWhenASessionStartsEndsOrIsAbandoned(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		w := newWhisperRoom(t, tx)
		w.whisper("before", w.lyra)
		w.startSession()
		if w.count() != 0 {
			t.Fatal("a session's start clears them")
		}
		w.whisper("during", w.lyra)
		w.send(w.gm, map[string]any{"type": "session.end"})
		if w.count() != 0 {
			t.Fatal("a session's end clears them")
		}
		w.startSession()
		w.whisper("during", w.lyra)
		w.send(w.gm, map[string]any{"type": "session.abandon"})
		if w.count() != 0 {
			t.Fatal("an abandoned session clears them")
		}
	})
}

func TestWhispersAreRefusedWithoutAGMAndCapped(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		w := newWhisperRoom(t, tx)
		id := w.whisper("kept", w.lyra)
		for i := 1; i < cs.MaxWhispers; i++ {
			w.whisper("more", w.bran)
		}
		w.refused(w.gm, map[string]any{"type": "whisper.send", "to": anyIDs(w.lyra), "text": "one too many"}, "whisperLimit")

		w.setMode(w.gm, "gmless")
		if w.count() != 0 {
			t.Fatal("a room that drops its GM drops its whispers")
		}
		for _, c := range []cs.Ctx{w.gm, w.lyraSeat} {
			w.refused(c, map[string]any{"type": "whisper.send", "to": anyIDs(w.lyra), "text": "x"}, "whispersNeedGm")
			w.refused(c, map[string]any{"type": "whisper.delete", "id": id}, "whispersNeedGm")
		}
		w.refused(w.lyraSeat, w.reply(id, w.lyra, "x"), "whispersNeedGm")
		w.refused(w.lyraSeat, map[string]any{"type": "whisper.read", "whisperId": id, "actorId": w.lyra}, "whispersNeedGm")
	})
}

// anyIDs is a list as a decoded socket payload holds it.
func anyIDs(ids ...string) []any {
	out := []any{}
	for _, id := range ids {
		out = append(out, id)
	}
	return out
}
