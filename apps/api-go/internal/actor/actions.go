package actor

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/image"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// The actor actions (apps/api/src/actor/actor.actions.ts and actor.draft.ts). actor.spawn is internal/pack's.

// Own is an actor of this campaign, as far as the access rules read it.
type Own struct {
	ID, Kind, Name string
	OwnerUserID    *string
}

// OwnActor is an actor of this campaign, or a refusal. Never trust an id from the client (CLAUDE.md, "Data rules").
func OwnActor(ctx context.Context, conn core.Conn, campaignID, id string) (Own, error) {
	var o Own
	err := conn.QueryRow(ctx, `SELECT id::text, kind, name, owner_user_id FROM actor WHERE id = $1 AND campaign_id = $2`,
		id, campaignID).Scan(&o.ID, &o.Kind, &o.Name, &o.OwnerUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, cs.Fail("characterNotFound")
	}
	return o, err
}

// CreateActor makes an actor and returns its id.
func CreateActor(ctx context.Context, tx core.Conn, campaignID, kind, name string, ownerUserID *string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `INSERT INTO actor (campaign_id, kind, name, owner_user_id) VALUES ($1, $2, $3, $4) RETURNING id::text`,
		campaignID, kind, name, ownerUserID).Scan(&id)
	return id, err
}

// Create is actor.create. A typed actor belongs to the pinned ruleset: an unknown type, or a room with no ruleset, is
// refused.
func Create(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	entity, typed := a["entityType"].(string)
	if !typed {
		id, err := CreateActor(ctx, tx, cid, a.Str("kind"), a.Str("name"), nil)
		if err != nil {
			return cs.Result{}, err
		}
		return cs.Done(id), holdForCreator(ctx, tx, c, id, a.Str("kind"))
	}
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if rules == nil {
		return cs.Result{}, cs.Fail("noRuleset")
	}
	if ce, ok := rules.Entities[entity]; !ok || ce.Def.Base != "actor" {
		return cs.Result{}, cs.Fail("noSuchEntity", cs.Params{"entity": entity})
	}
	id, err := CreateActor(ctx, tx, cid, a.Str("kind"), a.Str("name"), nil)
	if err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE actor SET entity_type = $1,
		ruleset_version_id = (SELECT ruleset_version_id FROM campaign WHERE id = $2) WHERE id = $3`, entity, cid, id); err != nil {
		return cs.Result{}, err
	}
	// House decision #23: a typed actor starts with its resources, so a game with no creation steps can score them.
	if _, err := WriteStart(ctx, tx, c, rules, []StartTarget{{ActorID: id, Fields: map[string]any{}}}); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(id), holdForCreator(ctx, tx, c, id, a.Str("kind"))
}

// holdForCreator seats a character a player makes with them. Without a GM there is no one to hand it out, so the owner
// who creates a character plays it (docs/adr/0009-table-modes.md); with a GM the GM invites a seat to it.
func holdForCreator(ctx context.Context, tx core.Conn, c cs.Ctx, actorID, kind string) error {
	if c.HasGM() || kind != "pc" || c.Seat.Kind != cs.SeatMember || c.UserID == nil {
		return nil
	}
	if _, err := tx.Exec(ctx, `INSERT INTO membership_character (membership_id, actor_id)
		SELECT id, $2 FROM membership WHERE campaign_id = $1 AND user_id = $3`, c.CampaignID, actorID, *c.UserID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE actor SET owner_user_id = $2 WHERE id = $1`, actorID, *c.UserID)
	return err
}

// Rename is actor.rename.
func Rename(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if _, err := OwnActor(ctx, tx, c.CampaignID, a.Str("id")); err != nil {
		return cs.Result{}, err
	}
	_, err := tx.Exec(ctx, `UPDATE actor SET name = $1 WHERE id = $2`, a.Str("name"), a.Str("id"))
	return cs.Done(""), err
}

// Delete is actor.delete. Before a character goes, every `listed` entry it was the last reader of turns GM-only, so a
// private handout never falls back to the whole table when its audience empties (docs/design.md §5.4).
func Delete(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	id := a.Str("id")
	if _, err := OwnActor(ctx, tx, c.CampaignID, id); err != nil {
		return cs.Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE codex_entry SET visibility = 'gm', audience_mode = 'all'
		WHERE campaign_id = $1 AND audience_mode = 'listed'
			AND id IN (SELECT entry_id FROM codex_reveal WHERE actor_id = $2)
			AND NOT EXISTS (SELECT 1 FROM codex_reveal r WHERE r.entry_id = codex_entry.id AND r.actor_id <> $2)`,
		c.CampaignID, id); err != nil {
		return cs.Result{}, err
	}
	var picture *string // seats, tokens and reveal rows cascade; its picture goes unless an entry shows it too
	if err := tx.QueryRow(ctx, `DELETE FROM actor WHERE id = $1 RETURNING image_id::text`, id).Scan(&picture); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(""), image.DropUnused(ctx, tx, c.CampaignID, picture)
}

// BuildAction is actor.build (BuildActor), answering with the logged action id.
func BuildAction(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action, lookups Lookups) (cs.Result, error) {
	id, err := BuildActor(ctx, tx, c, a, lookups)
	return cs.Done(id), err
}

// Draft is draft.save and draft.discard. A draft belongs to a signed-in member: a guest has no account to keep it
// under. It is saved only for a character the caller may build, and only under the ruleset the room has pinned.
func Draft(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	if c.UserID == nil || c.Seat.Kind != cs.SeatMember {
		return cs.Result{}, cs.Fail("signInToKeepDraft")
	}
	userID, cid := *c.UserID, c.CampaignID
	if a.Type() == "draft.discard" {
		_, err := tx.Exec(ctx, `DELETE FROM builder_draft WHERE user_id = $1 AND campaign_id = $2`, userID, cid)
		return cs.Done(""), err
	}
	body, _ := a["body"].(map[string]any)
	actorID, _ := body["actorId"].(string)
	if refused := cs.RequirePerm(c, "character:edit:own", actorID); refused != nil {
		return cs.Result{}, refused
	}
	if _, err := OwnActor(ctx, tx, cid, actorID); err != nil {
		return cs.Result{}, err
	}
	var version *string
	if err := tx.QueryRow(ctx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, cid).Scan(&version); err != nil {
		return cs.Result{}, err
	}
	if version == nil {
		return cs.Result{}, cs.Fail("noRuleset")
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return cs.Result{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO builder_draft (user_id, campaign_id, ruleset_version_id, body) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, campaign_id) DO UPDATE SET ruleset_version_id = EXCLUDED.ruleset_version_id,
			body = EXCLUDED.body, updated_at = now()`, userID, cid, *version, raw)
	return cs.Done(""), err
}
