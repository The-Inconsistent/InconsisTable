// Package randomtable rolls on a ruleset's random tables and deals from them without replacement (docs/p2-plan.md group
// F, docs/design.md §3.4, house decision #49). The server draws, with crypto/rand (CLAUDE.md, principles 5 and 6): the
// app only rolls or deals on random tables, never on a seat's Test. A roll is a session event of its own type, a deal is
// a row per card held; neither is a delta, so Undo never reads them and nobody can re-draw by undoing.
package randomtable

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
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

// Roll is table.roll: one draw, logged as a `table.roll` event. A table that is dealt (`owner`) is not rolled. A typed
// `result` is the GM's own roll (I ROLLED), which a `typedOnly` table needs; a table with a die reads the line its total
// reaches, with the inputs and, when it has a modifier, the target actor (house decision #87).
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
	result, typed := a["result"].(float64)
	if !typed && t.TypedOnly != nil && *t.TypedOnly {
		return cs.Result{}, cs.Fail("tableTypedOnly")
	}
	if t.Die == nil {
		if typed {
			return cs.Result{}, cs.Fail("badRequest", cs.Params{"detail": "a table without a die is drawn by weight"})
		}
		index, value, err := t.Roll(draw)
		if err != nil {
			return cs.Result{}, err
		}
		return logRoll(ctx, tx, c, tableID, t.Entries[index].ID, value, value)
	}
	if !typed {
		_, value, err := t.Roll(draw)
		if err != nil {
			return cs.Result{}, err
		}
		result = float64(value)
	}
	var scope *engine.Record
	var name string
	if t.Modifier != nil {
		_, b, err := lookupTarget(ctx, tx, c, t, a.Str("actorId"))
		if err != nil {
			return cs.Result{}, err
		}
		scope, name = b.Scope, b.Row.Name
	}
	inputs, _ := a["inputs"].(map[string]any)
	compiled, err := ruleset.LoadCompiled(ctx, tx, c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	read, refused := compiled.ReadLookup(tableID, result, inputs, scope)
	if refused != nil {
		return cs.Result{}, refusal(refused, name)
	}
	return logRoll(ctx, tx, c, tableID, t.Entries[read.Entry].ID, int(result), read.Total)
}

// logRoll logs one roll and answers with it.
func logRoll(ctx context.Context, tx core.Conn, c cs.Ctx, tableID, entryID string, value, total int) (cs.Result, error) {
	payload := map[string]any{"tableId": tableID, "entryId": entryID, "value": value}
	if total != value {
		payload["total"] = total
	}
	id, err := logEvent(ctx, tx, c, "table.roll", payload)
	r := cs.Done(id)
	r.Roll = &cs.RollAnswer{EntryID: entryID, Value: value, Total: total}
	return r, err
}

// lookupTarget is the room's ruleset context and the actor a lookup reads, or the refusal: an actor of this room the
// ruleset has a type for, of a type the table applies to, whose values the rules can read.
func lookupTarget(ctx context.Context, tx core.Conn, c cs.Ctx, t *engine.RandomTable, actorID string) (*ruleset.Context, *actor.Built, error) {
	if actorID == "" {
		return nil, nil, cs.Fail("tableNeedsTarget")
	}
	rc, err := ruleset.Open(ctx, tx, c)
	if err != nil {
		return nil, nil, err
	}
	b := rc.Built[actorID]
	switch {
	case b == nil:
		return nil, nil, cs.Fail("characterNotFound")
	case b.Entity == "":
		return nil, nil, cs.Fail("notBuilt", cs.Params{"name": b.Row.Name})
	case t.Entities != nil && !slices.Contains(*t.Entities, b.Entity):
		return nil, nil, cs.Fail("tableNotFor", cs.Params{"name": b.Row.Name})
	case b.Scope == nil:
		return nil, nil, cs.Fail("incomplete", cs.Params{"name": b.Row.Name, "detail": b.Problem})
	}
	return rc, b, nil
}

// refusal words the engine's reason a typed result cannot be read; a value the target lacks is its sheet's gap.
func refusal(r *engine.LookupRefusal, name string) error {
	switch r.Code {
	case "tableResultOut":
		return cs.Fail("tableResultOut", cs.Params{"min": r.Min, "max": r.Max})
	case "tableInput":
		return cs.Fail("tableInput", cs.Params{"input": r.Input})
	case "unreadable":
		if name == "" {
			return cs.Fail("tableNeedsTarget")
		}
		return cs.Fail("incomplete", cs.Params{"name": name, "detail": r.Detail})
	}
	return cs.Fail("tableNotFound")
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
