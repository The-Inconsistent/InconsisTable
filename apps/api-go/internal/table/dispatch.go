package table

import (
	"context"
	"errors"
	"log"
	"strings"

	"github.com/jackc/pgx/v5"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Result is an accepted action's ack: {ok: true}, with the id it made or the token it issued when it has one.
type Result struct {
	OK    bool   `json:"ok"`
	ID    string `json:"id,omitempty"`
	Token string `json:"token,omitempty"`
}

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
	case strings.HasPrefix(t, "codex."):
		return Touches{Codex: true}
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
	case "campaign.delete", "campaign.transferAccept":
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
	return t == "campaign.delete" || t == "campaign.transferAccept" || t == "seat.leave"
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

// RequirePerm is can(perm) for an action or an op (docs/design.md §5.3, step 3): the permission itself, or the GM-side
// one an :own permission falls back to. It returns the refusal the sender reads, or nil.
func RequirePerm(c cs.Ctx, perm, targetActorID string) *cs.Error {
	if cs.CanInCampaign(c, perm, targetActorID) {
		return nil
	}
	if fallback, ok := cs.OwnFallback[perm]; ok && cs.CanInCampaign(c, fallback, targetActorID) {
		return nil
	}
	if c.Seat.Kind == cs.SeatToken && c.Seat.Role == "screen" {
		return cs.Fail("screenReadOnly")
	}
	if strings.HasSuffix(perm, ":own") {
		return cs.Fail("notYourCharacter")
	}
	return cs.Fail("noPermission")
}

// Authorize checks the permission the action declares. An action without one checks its caller itself.
func Authorize(c cs.Ctx, a cs.Action) *cs.Error {
	perm := cs.ActionPerms[a.Type()]
	if perm == "" {
		return nil
	}
	return RequirePerm(c, perm, targetOf(a))
}

// ApplyAction runs one action in its transaction: the state version bump, the owner read from that row, the archived
// guard, the permission, then the action's handler. A refusal comes back as a *coreschema.Error, which rolls back the
// version bump.
func ApplyAction(ctx context.Context, tx pgx.Tx, seated cs.Ctx, a cs.Action) (Result, error) {
	// Every action bumps the state version in its own transaction (docs/design.md §5.6), and an archived game is
	// read-only except for the way out of it.
	var archived bool
	var owner *string
	err := tx.QueryRow(ctx, `UPDATE campaign SET state_version = state_version + 1 WHERE id = $1
		RETURNING archived_at IS NOT NULL, owner_user_id`, seated.CampaignID).Scan(&archived, &owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, cs.Fail("gameNotFound")
	}
	if err != nil {
		return Result{}, err
	}
	// The owner comes from this row, not the handshake: a socket opened before a transfer must not keep its powers.
	c := seated
	c.CampaignOwnerID = owner
	if archived && !cs.IsArchivedOpen(a.Type()) {
		return Result{}, cs.Fail("gameArchived")
	}
	if refusal := Authorize(c, a); refusal != nil {
		return Result{}, refusal
	}
	return dispatch(ctx, tx, c, a)
}

func notPorted(t string) (Result, error) {
	log.Printf("not ported: %s", t)
	return Result{}, cs.Fail("serverError")
}

// dispatch sends an authorized action to its feature's handler.
//
// ponytail: unported action types refuse serverError, each feature phase replaces its cases.
func dispatch(_ context.Context, _ pgx.Tx, _ cs.Ctx, a cs.Action) (Result, error) {
	switch t := a.Type(); t {
	case "campaign.update", "campaign.archive", "campaign.unarchive", "campaign.delete",
		"session.start", "session.end", "session.edit":
		return notPorted(t) // campaign/campaign.actions.ts

	case "campaign.setRuleset", "campaign.unpinRuleset", "campaign.attachPack", "campaign.detachPack":
		return notPorted(t) // campaign/rules.actions.ts

	case "actor.create", "actor.rename", "actor.delete", "actor.build", "actor.spawn", "draft.save", "draft.discard":
		return notPorted(t) // actor/actor.actions.ts

	case "invite.create", "invite.revoke", "member.remove", "member.appoint", "member.seat", "seat.leave",
		"token.issue", "token.revoke", "screen.issue", "screen.revoke",
		"campaign.transfer", "campaign.transferCancel", "campaign.transferAccept":
		return notPorted(t) // auth/access.actions.ts

	case "rule.op", "field.set", "condition.add", "condition.remove", "actor.rest":
		return notPorted(t) // ruleset/ruleset.actions.ts

	case "test.call", "test.report", "test.close":
		return notPorted(t) // test-call/test-call.actions.ts

	case "encounter.start", "encounter.end", "encounter.add", "encounter.remove", "encounter.setInitiative",
		"encounter.move", "encounter.setVisibility", "encounter.keep", "turn.next", "turn.prev", "turn.first",
		"phase.done":
		return notPorted(t) // encounter/encounter.actions.ts

	case "game.end", "result.set":
		return notPorted(t) // game/game.actions.ts

	case "event.undo":
		return notPorted(t) // campaign/event.actions.ts

	case "codex.save", "codex.reveal", "codex.delete":
		return notPorted(t) // codex/codex.actions.ts

	default:
		return notPorted(t) // ActionSchema let through a type this switch does not know
	}
}
