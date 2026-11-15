// Package randomtable rolls on a ruleset's random tables and deals from them without replacement (docs/p2-plan.md group
// F, docs/design.md §3.4, house decision #49). The server draws, with crypto/rand (CLAUDE.md, principles 5 and 6): the
// app only rolls or deals on random tables, never on a seat's Test. A roll is a session event of its own type, a deal is
// a row per card held; neither is a delta, so Undo never reads them and nobody can re-draw by undoing.
package randomtable

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// MaxRolls is how many recent rolls the table keeps showing.
const MaxRolls = 10

// draw is the randomness: uniform in [1, sides]. A package variable so a test can script it.
var draw engine.Rng = engine.CryptoRng

// The table the action names, from the ruleset the room has pinned, or tableNotFound.
func tableOf(ctx context.Context, tx core.Conn, campaignID, id string) (*engine.RandomTable, error) {
	compiled, err := ruleset.LoadCompiled(ctx, tx, campaignID)
	if err != nil {
		return nil, err
	}
	if compiled != nil {
		if t, found := compiled.Ruleset.Tables[id]; found {
			return &t, nil
		}
	}
	return nil, cs.Fail("tableNotFound")
}

// A `gm` table keeps what it shows from the table, which a room without a GM cannot do.
func checkGM(c cs.Ctx, t *engine.RandomTable) error {
	if t.Visibility == "gm" && !c.HasGM() {
		return cs.Fail("tableNoGm")
	}
	return nil
}

func logEvent(ctx context.Context, tx core.Conn, c cs.Ctx, kind string, payload map[string]any) (string, error) {
	sessionID, err := eventlog.RunningSessionID(ctx, tx, c.CampaignID)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO session_event (campaign_id, session_id, type, seat_user_id, payload)
		VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, c.CampaignID, sessionID, kind, c.UserID, body).Scan(&id)
	return id, err
}

// Roll is table.roll: one draw, logged as a `table.roll` event. A table that is dealt (`owner`) is not rolled.
func Roll(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	tableID := a.Str("tableId")
	t, err := tableOf(ctx, tx, c.CampaignID, tableID)
	if err != nil {
		return cs.Result{}, err
	}
	if t.Visibility == "owner" {
		return cs.Result{}, cs.Fail("tableDealOnly")
	}
	if err := checkGM(c, t); err != nil {
		return cs.Result{}, err
	}
	index, value, err := t.Roll(draw)
	if err != nil {
		return cs.Result{}, err
	}
	id, err := logEvent(ctx, tx, c, "table.roll", map[string]any{"tableId": tableID, "entryId": t.Entries[index].ID, "value": value})
	return cs.Done(id), err
}

// Deal is table.deal: each listed character gets one card from the table's deck, uniformly at random, never one that is
// already dealt and not returned. The deck holds each entry `count` times. A refusal leaves nothing dealt.
func Deal(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	tableID := a.Str("tableId")
	t, err := tableOf(ctx, tx, c.CampaignID, tableID)
	if err != nil {
		return cs.Result{}, err
	}
	if err := checkGM(c, t); err != nil {
		return cs.Result{}, err
	}
	actors := stringsOf(a["actorIds"])
	if err := ownCharacters(ctx, tx, c.CampaignID, actors); err != nil {
		return cs.Result{}, err
	}
	// The deck, and what a character already holds. The action's transaction holds the campaign row, so two deals never
	// read the same deck; the unique constraint is the backstop.
	deck := map[string]int{}
	for _, e := range t.Entries {
		deck[e.ID] = e.Copies()
	}
	rows, err := tx.Query(ctx, `SELECT actor_id::text, entry_id FROM table_deal WHERE campaign_id = $1 AND table_id = $2`,
		c.CampaignID, tableID)
	if err != nil {
		return cs.Result{}, err
	}
	held := map[string]bool{}
	for rows.Next() {
		var actor, entry string
		if err := rows.Scan(&actor, &entry); err != nil {
			return cs.Result{}, err
		}
		held[actor] = true
		deck[entry]--
	}
	if err := rows.Err(); err != nil {
		return cs.Result{}, err
	}
	for _, actor := range actors {
		if held[actor] {
			return cs.Result{}, cs.Fail("tableHeld")
		}
	}
	var cards []string // one entry id per card still in the deck
	for _, e := range t.Entries {
		for range max(deck[e.ID], 0) {
			cards = append(cards, e.ID)
		}
	}
	if len(cards) < len(actors) {
		return cs.Result{}, cs.Fail("tableShort")
	}
	for _, actor := range actors {
		pick := draw(len(cards)) - 1
		if _, err := tx.Exec(ctx, `INSERT INTO table_deal (campaign_id, table_id, actor_id, entry_id) VALUES ($1, $2, $3, $4)`,
			c.CampaignID, tableID, actor, cards[pick]); err != nil {
			return cs.Result{}, err
		}
		cards = append(cards[:pick], cards[pick+1:]...)
	}
	// The log names who was dealt, never what: the GM side reads the cards from the table's state.
	id, err := logEvent(ctx, tx, c, "table.deal", map[string]any{"tableId": tableID, "actorIds": actors})
	return cs.Done(id), err
}

// Reshuffle is table.reshuffle: every card of the table goes back to the deck.
func Reshuffle(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	tableID := a.Str("tableId")
	t, err := tableOf(ctx, tx, c.CampaignID, tableID)
	if err != nil {
		return cs.Result{}, err
	}
	if err := checkGM(c, t); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM table_deal WHERE campaign_id = $1 AND table_id = $2`, c.CampaignID, tableID); err != nil {
		return cs.Result{}, err
	}
	id, err := logEvent(ctx, tx, c, "table.reshuffle", map[string]any{"tableId": tableID})
	return cs.Done(id), err
}

// Every id is a character (pc or companion) of this room, or characterNotFound: a deal never reaches into another room.
func ownCharacters(ctx context.Context, tx core.Conn, campaignID string, ids []string) error {
	var found int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM actor WHERE campaign_id = $1 AND kind IN ('pc', 'companion') AND id = ANY($2::uuid[])`,
		campaignID, ids).Scan(&found)
	if err != nil {
		return err
	}
	if found != len(ids) {
		return cs.Fail("characterNotFound")
	}
	return nil
}

func stringsOf(v any) []string {
	items, _ := v.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// LoadRolls is the last MaxRolls rolls, newest first, each with the label and visibility its table has now. A roll of a
// table the ruleset no longer has reads as `gm` with its entry id as its label: fail-closed.
func LoadRolls(ctx context.Context, conn core.Conn, campaignID string, compiled *engine.CompiledRuleset) ([]cs.RollRow, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, created_at, payload FROM session_event
		WHERE campaign_id = $1 AND type = 'table.roll' ORDER BY created_at DESC, id DESC LIMIT $2`, campaignID, MaxRolls)
	if err != nil {
		return nil, err
	}
	rolls, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.RollRow, error) {
		var out cs.RollRow
		var at time.Time
		var payload []byte
		if err := r.Scan(&out.ID, &at, &payload); err != nil {
			return out, err
		}
		var body struct {
			TableID string `json:"tableId"`
			EntryID string `json:"entryId"`
			Value   int    `json:"value"`
		}
		if err := json.Unmarshal(payload, &body); err != nil {
			return out, err
		}
		out.TableID, out.EntryID, out.Value, out.At = body.TableID, body.EntryID, body.Value, core.ISOTime(at)
		out.Label, out.Visibility = describe(compiled, body.TableID, body.EntryID)
		return out, nil
	})
	if rolls == nil {
		rolls = []cs.RollRow{}
	}
	return rolls, err
}

// LoadDealt is every card held, oldest first.
func LoadDealt(ctx context.Context, conn core.Conn, campaignID string, compiled *engine.CompiledRuleset) ([]cs.DealtRow, error) {
	rows, err := conn.Query(ctx, `SELECT table_id, actor_id::text, entry_id FROM table_deal
		WHERE campaign_id = $1 ORDER BY dealt_at, id`, campaignID)
	if err != nil {
		return nil, err
	}
	dealt, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.DealtRow, error) {
		var out cs.DealtRow
		err := r.Scan(&out.TableID, &out.ActorID, &out.EntryID)
		out.Label, out.Visibility = describe(compiled, out.TableID, out.EntryID)
		return out, err
	})
	if dealt == nil {
		dealt = []cs.DealtRow{}
	}
	return dealt, err
}

// The entry's label and its table's visibility; `gm` and the entry id when the ruleset does not have them.
func describe(compiled *engine.CompiledRuleset, tableID, entryID string) (label, visibility string) {
	if compiled == nil {
		return entryID, "gm"
	}
	t, found := compiled.Ruleset.Tables[tableID]
	if !found {
		return entryID, "gm"
	}
	for _, e := range t.Entries {
		if e.ID == entryID {
			return e.Label, t.Visibility
		}
	}
	return entryID, t.Visibility
}
