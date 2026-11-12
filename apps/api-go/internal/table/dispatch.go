package table

import (
	"context"
	"errors"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/clock"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/codex"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/game"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/request"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/testcall"
)

// Result is an accepted action's ack (coreschema.Result), what every feature's handler returns.
type Result = cs.Result

// Refused is a refusal's ack: the refusal body plus `error`, the same text for older web builds.
func Refused(code string, params cs.Params) map[string]any {
	body := cs.RefusalBody(code, params)
	out := map[string]any{"ok": false, "error": body.Message, "code": body.Code, "message": body.Message}
	if params != nil {
		out["params"] = params
	}
	return out
}

// Touches says which snapshot an action changes, so the gateway only rebroadcasts what moved.
type Touches struct{ State, Codex bool }

// TouchesOf is which snapshot an action changes.
func TouchesOf(a cs.Action) Touches {
	t := a.Type()
	switch {
	case t == "campaign.delete":
		return Touches{} // a deleted game has nothing left to broadcast; the gateway kicks the room instead
	case t == "codex.delete":
		return Touches{State: true, Codex: true} // a clock about the deleted entry loses its link
	case strings.HasPrefix(t, "codex."):
		return Touches{Codex: true}
	case t == "session.end" || t == "session.edit":
		return Touches{State: true, Codex: true} // the recaps ride the codex snapshot
	case t == "actor.delete":
		return Touches{State: true, Codex: true} // a deleted character can empty a private handout's audience
	case t == "rule.op":
		// A ruleset op says itself what it changes (docs/design.md §5.3).
		touched := engine.OpTouches(a.Str("primitive"), a.Str("op"))
		return Touches{State: touched != "codex", Codex: touched != "state"}
	}
	return Touches{State: true}
}

// Kick names the sockets to disconnect after an action, so they reconnect with their new (or no) seat. Exactly one of
// its forms is set: a user, the guests (or every seat) holding an actor, every screen, or everyone.
type Kick struct {
	UserID     string
	ActorID    string
	TokensOnly bool
	Screens    bool
	All        bool
}

// KicksOf is the sockets to disconnect after this action: a removed or re-appointed member, the guests of a revoked or
// deleted character, every screen, everyone at a deleted game, or every socket of a seat that left.
//
// ponytail: ops declare no kicks yet (PrimitiveOp has none); a rule.op, field.set and the rest kick nobody.
func KicksOf(c cs.Ctx, a cs.Action) []Kick {
	switch a.Type() {
	case "member.remove", "member.appoint", "member.seat":
		return []Kick{{UserID: a.Str("userId")}}
	case "token.revoke":
		return []Kick{{ActorID: a.Str("actorId"), TokensOnly: true}} // members keep their seat
	case "actor.delete":
		return []Kick{{ActorID: a.Str("id")}}
	case "screen.revoke":
		return []Kick{{Screens: true}}
	case "campaign.delete", "campaign.transferAccept", "campaign.setTableMode":
		// A new owner: every seat resolves again, so the old owner loses the owner's powers and the new one gains them.
		return []Kick{{All: true}}
	case "seat.leave":
		if c.Seat.Kind == cs.SeatMember && c.UserID != nil {
			return []Kick{{UserID: *c.UserID}}
		}
		if c.Seat.Kind == cs.SeatToken {
			out := []Kick{}
			for _, id := range c.Seat.CharacterIDs {
				out = append(out, Kick{ActorID: id, TokensOnly: true})
			}
			return out
		}
	}
	return nil
}

// KicksSender says whether the action's kicks reach the sender, who then waits a moment so the ack gets there first.
func KicksSender(a cs.Action) bool {
	t := a.Type()
	return t == "campaign.delete" || t == "campaign.transferAccept" || t == "campaign.setTableMode" || t == "seat.leave"
}

// Hits says whether a kick reaches a socket of this seat.
func (k Kick) Hits(c cs.Ctx) bool {
	switch {
	case k.All:
		return true
	case k.Screens:
		return c.Seat.Kind == cs.SeatToken && c.Seat.Role == "screen"
	case k.UserID != "":
		return c.UserID != nil && *c.UserID == k.UserID
	}
	if c.Seat.Kind == cs.SeatAdmin {
		return false
	}
	for _, id := range c.Seat.CharacterIDs {
		if id == k.ActorID {
			return !k.TokensOnly || c.Seat.Kind == cs.SeatToken
		}
	}
	return false
}

// The :own target an action names, if any.
func targetOf(a cs.Action) string {
	switch a.Type() {
	case "actor.rename":
		return a.Str("id")
	case "field.set", "test.report", "actor.build", "phase.done":
		return a.Str("actorId")
	}
	return ""
}

// Authorize checks the permission the action declares. An action without one checks its caller itself.
func Authorize(c cs.Ctx, a cs.Action) *cs.Error {
	perm := cs.ActionPerms[a.Type()]
	if perm == "" {
		return nil
	}
	return cs.RequirePerm(c, perm, targetOf(a))
}

// ApplyAction runs one action in its transaction: the state version bump, the owner read from that row, the archived
// guard, the permission, then the action's handler. A refusal comes back as a *coreschema.Error, which rolls back the
// version bump.
func ApplyAction(ctx context.Context, tx pgx.Tx, seated cs.Ctx, a cs.Action) (Result, error) {
	// Every action bumps the state version in its own transaction (docs/design.md §5.6), and an archived game is
	// read-only except for the way out of it.
	var archived bool
	var owner *string
	var mode string
	err := tx.QueryRow(ctx, `UPDATE campaign SET state_version = state_version + 1 WHERE id = $1
		RETURNING archived_at IS NOT NULL, owner_user_id, table_mode`, seated.CampaignID).Scan(&archived, &owner, &mode)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, cs.Fail("gameNotFound")
	}
	if err != nil {
		return Result{}, err
	}
	// The owner and the table mode come from this row, not the handshake: a socket opened before a transfer, or before the
	// table changed how it sits, must not keep its powers.
	c := seated
	c.CampaignOwnerID = owner
	c.TableMode = mode
	if archived && !cs.IsArchivedOpen(a.Type()) {
		return Result{}, cs.Fail("gameArchived")
	}
	if refusal := Authorize(c, a); refusal != nil {
		return Result{}, refusal
	}
	return dispatch(ctx, tx, c, a)
}

// A feature's handler for one action type. A refusal is a *coreschema.Error, which rolls the transaction back.
type handler func(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (Result, error)

// actor.build picks from the room's served packs, as this seat may see them (a player never picks a `gm` entry).
func buildActor(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (Result, error) {
	return actor.BuildAction(ctx, tx, c, a, pack.ServedLookup)
}

// handlers is each ported action's handler, by type.
var handlers = map[string]handler{
	// campaign/campaign.actions.ts
	"campaign.update":    campaign.Update,
	"campaign.archive":   campaign.Archive,
	"campaign.unarchive": campaign.Unarchive,
	"campaign.delete":    campaign.Delete,
	"session.start":      campaign.SessionStart,
	"session.end":        campaign.SessionEnd,
	"session.edit":       campaign.SessionEdit,
	// campaign/rules.actions.ts
	"campaign.setRuleset":   campaign.SetRuleset,
	"campaign.unpinRuleset": campaign.UnpinRuleset,
	"campaign.setTableMode": campaign.SetTableMode,
	"campaign.attachPack":   campaign.AttachPack,
	"campaign.detachPack":   campaign.DetachPack,
	// campaign/event.actions.ts
	"event.undo": campaign.Undo,
	// actor/actor.actions.ts
	"actor.create":  actor.Create,
	"actor.rename":  actor.Rename,
	"actor.delete":  actor.Delete,
	"actor.build":   buildActor,
	"draft.save":    actor.Draft,
	"draft.discard": actor.Draft,
	// actor/actor.spawn.ts
	"actor.spawn": pack.Spawn,
	// encounter/encounter.actions.ts
	"encounter.start":         encounter.Action,
	"encounter.end":           encounter.Action,
	"encounter.add":           encounter.Action,
	"encounter.remove":        encounter.Action,
	"encounter.setInitiative": encounter.Action,
	"encounter.move":          encounter.Action,
	"encounter.setVisibility": encounter.Action,
	"encounter.keep":          encounter.Action,
	"turn.next":               encounter.Action,
	"turn.prev":               encounter.Action,
	"turn.first":              encounter.Action,
	"phase.done":              encounter.Action,
	// test-call/test-call.actions.ts
	"test.call":   testcall.Action,
	"test.report": testcall.Action,
	"test.close":  testcall.Action,
	// game/game.actions.ts
	"game.end":   game.End,
	"result.set": game.SetResult,
	// auth/access.actions.ts
	"invite.create":           auth.InviteCreate,
	"invite.revoke":           auth.InviteRevoke,
	"member.remove":           auth.MemberRemove,
	"member.appoint":          auth.MemberAppoint,
	"member.seat":             auth.MemberSeat,
	"seat.leave":              auth.SeatLeave,
	"token.issue":             auth.TokenIssue,
	"token.revoke":            auth.TokenRevoke,
	"screen.issue":            auth.ScreenIssue,
	"screen.revoke":           auth.ScreenRevoke,
	"campaign.transfer":       auth.Transfer,
	"campaign.transferCancel": auth.TransferCancel,
	"campaign.transferAccept": auth.TransferAccept,
	// ruleset/ruleset.actions.ts
	"rule.op":          ruleset.RuleOp,
	"field.set":        ruleset.FieldSet,
	"condition.add":    ruleset.ConditionAdd,
	"condition.remove": ruleset.ConditionRemove,
	"actor.rest":       ruleset.ActorRest,
	// codex/codex.actions.ts
	"codex.save":   codex.Save,
	"codex.reveal": codex.Reveal,
	"codex.delete": codex.Delete,
	"codex.move":   codex.Move,
	"codex.link":   codex.Link,
	"codex.unlink": codex.Unlink,
	// clock/clock.go
	"clock.create": clock.Create,
	"clock.tick":   clock.Tick,
	"clock.update": clock.Update,
	"clock.delete": clock.Delete,
	// request/request.go
	"request.send":    request.Send,
	"request.cancel":  request.Cancel,
	"request.approve": request.Approve,
	"request.deny":    request.Deny,
}

// dispatch sends an authorized action to its feature's handler. Every action type has one (dispatch_test.go); a type
// without one is a bug, refused as serverError.
func dispatch(ctx context.Context, tx pgx.Tx, c cs.Ctx, a cs.Action) (Result, error) {
	if h, known := handlers[a.Type()]; known {
		return h(ctx, tx, c, a)
	}
	log.Printf("no handler for %s", a.Type())
	return Result{}, cs.Fail("serverError")
}
