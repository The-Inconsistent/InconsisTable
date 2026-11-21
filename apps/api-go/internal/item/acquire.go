package item

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Acquiring an item by a Test (house decision #102). A seat asks for a served pack entry (request.send); the side that
// runs the table calls the ruleset's Test with the inputs the acquisition works out (request.approve); the phone
// reports its dice and the server resolves them; a pass offers the grant, a miss within the top-up offers it for the
// resource short, each applied once through test.applyOffer, and Undo takes it back.

// Ask is what a seat asks to acquire: a served entry, the item or build line it is fitted to at once, and the picks.
type Ask struct {
	ActorID, Type, Key, To, Line string
	Picks                        map[string]any
}

// AskOf reads request.send's acquire form.
func AskOf(a cs.Action) Ask {
	acq, _ := a["acquire"].(map[string]any)
	picks, _ := a["inputs"].(map[string]any)
	if picks == nil {
		picks = map[string]any{}
	}
	s := func(k string) string { v, _ := acq[k].(string); return v }
	return Ask{ActorID: a.Str("actorId"), Type: s("type"), Key: s("entry"), To: s("to"), Line: s("line"), Picks: picks}
}

// Acquired is what a call made for an acquisition grants on a pass, worked out when it was called (test_call.acquire).
type Acquired struct {
	ActorID  string   `json:"actorId"`
	Type     string   `json:"type"`
	Key      string   `json:"key"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	To       string   `json:"to,omitempty"`
	Line     string   `json:"line,omitempty"`
	Quantity *float64 `json:"quantity,omitempty"`
	Load     *struct {
		Key      string  `json:"key"`
		Quantity float64 `json:"quantity"`
	} `json:"load,omitempty"`
	TopUp *struct {
		Resource string  `json:"resource"`
		Max      float64 `json:"max"`
	} `json:"topUp,omitempty"`
	// Inputs are the Test's inputs, each its total and its parts, as the call was made with them.
	Inputs map[string]engine.AcquireInput `json:"inputs"`
}

// Plan checks an ask on the room as it stands and works out what it calls and grants, or refuses it: the acquisition's
// own refusals (planAcquire), itemNoEntry for an entry the room is not served, acquireLimit for a limit of the kind
// reached this session, itemAlready and itemsFull for an item the actor could not hold, and the fit's refusals for a
// host. The Test is the acquisition's.
func Plan(ctx context.Context, tx core.Conn, c cs.Ctx, ask Ask) (string, *Acquired, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return "", nil, err
	}
	a := r.items.Acquire
	if a == nil {
		return "", nil, cs.Fail("noAcquire")
	}
	b, err := r.holder(ask.ActorID)
	if err != nil {
		return "", nil, err
	}
	s, err := r.served(ask.Type, ask.Key)
	if err != nil {
		return "", nil, err
	}
	if s == nil {
		return "", nil, cs.Fail("itemNoEntry", cs.Params{"entry": ask.Key})
	}
	if b.State == nil {
		return "", nil, cs.Fail("incomplete", cs.Params{"name": b.Row.Name, "detail": b.Problem})
	}
	state := *b.State
	state.Scope = b.Scope
	p, refusal := engine.PlanAcquire(r.rc.Compiled.Ruleset, &state,
		engine.AcquireItem{Type: ask.Type, Key: ask.Key, Name: s.Name, Tags: s.Tags, Body: s.Body}, ask.Picks)
	if refusal != nil {
		return "", nil, cs.Fail(refusal.Code, cs.Params{"name": b.Row.Name, "entry": s.Name, "kind": "", "detail": refusal.Message})
	}
	kind := r.items.Kind(p.Kind)
	if err := r.underLimits(b, kind); err != nil {
		return "", nil, err
	}
	out := &Acquired{ActorID: b.Row.ID, Type: ask.Type, Key: ask.Key, Name: s.Name, Kind: kind.ID, Quantity: p.Quantity,
		Load: p.Load, TopUp: p.TopUp, Inputs: p.Inputs}
	if _, err := r.grant(b, out, s, ask.To, ask.Line); err != nil {
		return "", nil, err
	}
	out.To, out.Line = ask.To, ask.Line
	return a.Test, out, nil
}

// underLimits refuses a kind whose limit the actor reached in the running session: the acquisition calls of its kinds
// for the actor, open or reported (a call closed with no report does not count).
func (r *room) underLimits(b *actor.Built, kind *engine.ItemKind) error {
	session, err := eventlog.RunningSessionID(r.ctx, r.tx, r.c.CampaignID)
	if err != nil {
		return err
	}
	if session == nil {
		return cs.Fail("noSessionRunning")
	}
	for _, l := range r.items.Acquire.Limits {
		if !slices.Contains(l.Kinds, kind.ID) {
			continue
		}
		var taken int
		if err := r.tx.QueryRow(r.ctx, `SELECT count(*) FROM test_call t JOIN test_call_target g ON g.call_id = t.id
			WHERE t.campaign_id = $1 AND t.session_id = $2 AND g.actor_id = $3 AND t.acquire_kind = ANY($4)
				AND (t.status = 'open' OR EXISTS (SELECT 1 FROM test_report p WHERE p.call_id = t.id AND p.actor_id = g.actor_id))`,
			r.c.CampaignID, *session, b.Row.ID, l.Kinds).Scan(&taken); err != nil {
			return err
		}
		if taken >= l.Max {
			return cs.Fail("acquireLimit", cs.Params{"name": b.Row.Name, "kind": kind.Label, "max": l.Max})
		}
	}
	return nil
}

// grant writes, as deltas on r, what acquiring the entry gives b: a counted kind's quantity added to its row of the
// entry or a new row, else a new item (refused as an item the actor could not hold), fitted at once to the item `to` or
// the build line `line`; and the stores the entry loads. It returns the new item's id ("" for a counted one).
func (r *room) grant(b *actor.Built, acq *Acquired, s *served, to, line string) (string, error) {
	kind := r.items.Kind(acq.Kind)
	if kind == nil {
		return "", cs.Fail("noItemKind", cs.Params{"kind": acq.Kind})
	}
	key := acq.Key
	if kind.Counted() {
		if to != "" || line != "" {
			return "", cs.Fail("itemNoFit", cs.Params{"item": s.Name})
		}
		r.addCounted(b, kind, acq.Type, key, *acq.Quantity)
	} else {
		if err := canHold(b, kind, &key, s.Name); err != nil {
			return "", err
		}
		fields := map[string]any{"kind": kind.ID, "source": "acquire", "entryType": acq.Type, "entryKey": key}
		if to != "" || line != "" {
			if kind.Fits == nil {
				return "", cs.Fail("itemNoFit", cs.Params{"item": s.Name})
			}
			h, err := r.hostOf(b, kind, "", s.Name, to, line)
			if err != nil {
				return "", err
			}
			slot := ""
			if kind.Fits.Slot != nil {
				slot, _ = s.Body[*kind.Fits.Slot].(string)
			}
			if err := r.canFit(b, kind, fitting{Key: &key, Label: s.Name, Tags: s.Tags, Slot: slot}, h); err != nil {
				return "", err
			}
			for k, v := range h.Change {
				fields[k] = v
			}
		}
		r.add(b, fields)
	}
	if acq.Load != nil {
		loaded, err := r.counted(acq.Load.Key)
		if err != nil {
			return "", err
		}
		if loaded != nil && slices.Contains(loaded.kind.Entities, b.Entity) {
			r.addCounted(b, loaded.kind, loaded.kind.Entry, acq.Load.Key, acq.Load.Quantity)
		}
	}
	return "", nil
}

// addCounted adds q of a counted entry to b: to its row of the entry, or a new row, at most MaxQuantity.
func (r *room) addCounted(b *actor.Built, kind *engine.ItemKind, typ, key string, q float64) {
	for _, x := range b.Items {
		if x.Kind == kind.ID && x.EntryKey != nil && *x.EntryKey == key && x.Quantity != nil {
			r.set(x.ID, value(b.Row.ID, x, map[string]any{"quantity": float64(min(MaxQuantity, *x.Quantity+int(q)))}))
			return
		}
	}
	r.add(b, map[string]any{"kind": kind.ID, "source": "acquire", "entryType": typ, "entryKey": key,
		"quantity": float64(min(MaxQuantity, int(q)))})
}

// counted is the served entry with key of a counted kind's entry type, and that kind; nil when the room is served none.
func (r *room) counted(key string) (*struct{ kind *engine.ItemKind }, error) {
	for i := range r.items.Kinds {
		k := &r.items.Kinds[i]
		if !k.Counted() {
			continue
		}
		s, err := r.served(k.Entry, key)
		if err != nil {
			return nil, err
		}
		if s != nil && r.items.KindOf(k.Entry, s.Tags) == k {
			return &struct{ kind *engine.ItemKind }{k}, nil
		}
	}
	return nil, nil
}

// Grant is the deltas of an acquisition call's grant for its actor, checked on the room as it stands now: test.applyOffer
// writes them with the top-up's cost as one action. The entry must still be served.
func Grant(ctx context.Context, tx core.Conn, c cs.Ctx, acq *Acquired) ([]engine.Delta, error) {
	r, err := open(ctx, tx, c)
	if err != nil {
		return nil, err
	}
	b, err := r.holder(acq.ActorID)
	if err != nil {
		return nil, err
	}
	s, err := r.served(acq.Type, acq.Key)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, cs.Fail("itemNoEntry", cs.Params{"entry": acq.Key})
	}
	if _, err := r.grant(b, acq, s, acq.To, acq.Line); err != nil {
		return nil, err
	}
	return r.deltas, nil
}

// MarkCall records on a call made for an acquisition what it grants (test_call.acquire, house decision #102).
func MarkCall(ctx context.Context, tx core.Conn, callID string, acq *Acquired) error {
	doc, err := json.Marshal(acq)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE test_call SET acquire_kind = $2, acquire = $3 WHERE id = $1`, callID, acq.Kind, doc)
	return err
}

// LoadAcquired is what the room's acquisition calls grant, by call id.
func LoadAcquired(ctx context.Context, conn core.Conn, callIDs []string) (map[string]*Acquired, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, acquire FROM test_call WHERE id = ANY($1::uuid[]) AND acquire IS NOT NULL`, callIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]*Acquired{}
	for rows.Next() {
		var id string
		var doc []byte
		if err := rows.Scan(&id, &doc); err != nil {
			return nil, err
		}
		var a Acquired
		if err := json.Unmarshal(doc, &a); err != nil {
			return nil, err
		}
		out[id] = &a
	}
	return out, rows.Err()
}
