package table

import (
	"context"
	"errors"
	"maps"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/clock"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/codex"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/game"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/randomtable"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/request"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/testcall"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// Loaded is both snapshots, whole, with the ruleset they were built under: the input of a Seat view.
type Loaded struct {
	Snapshot view.Snapshot
	Compiled *engine.CompiledRuleset
}

func isoPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := core.ISOTime(*t)
	return &s
}

// LoadLive is the live snapshot with the ruleset it was built under and the room's drafts, read after the action's
// transaction commits (CLAUDE.md, "The server decides"). It is whole: what a seat receives is the Seat view's call.
// Nil for a gone campaign.
//
// ponytail: whole snapshot per action, fine at table scale; versioned per-seat patches once a snapshot passes ~256 KB or
// its build passes ~50 ms at p95 in the P4 load test (docs/design.md §5.6).
func LoadLive(ctx context.Context, conn core.Conn, campaignID string) (*cs.LiveState, *engine.CompiledRuleset, map[string]any, error) {
	state := cs.LiveState{Actors: []cs.Actor{}}
	var nextSessionAt *time.Time
	err := conn.QueryRow(ctx, `SELECT id::text, name, owner_user_id, archived_at IS NOT NULL, next_session_at, next_session_place, table_mode, safety,
		state_version, world_version_id::text FROM campaign WHERE id = $1`, campaignID).Scan(&state.Campaign.ID, &state.Campaign.Name,
		&state.Campaign.OwnerUserID, &state.Campaign.Archived, &nextSessionAt, &state.Campaign.NextSessionPlace, &state.Campaign.TableMode, &state.Campaign.Safety, &state.StateVersion,
		&state.Campaign.WorldVersionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, nil
	}
	if err != nil {
		return nil, nil, nil, err
	}
	state.Campaign.NextSessionAt = isoPtr(nextSessionAt)
	state.Campaign.Safety = state.Campaign.Safety.Whole()
	compiled, err := ruleset.LoadCompiled(ctx, conn, campaignID)
	if err != nil {
		return nil, nil, nil, err
	}

	// ponytail: every session with its notes in each snapshot, fine for a campaign's few dozen sessions; page the journal
	// once a room passes ~200 sessions.
	sessions, err := conn.Query(ctx, `SELECT id::text, number, title, started_at, ended_at, recap, notes, abandoned FROM session
		WHERE campaign_id = $1 ORDER BY number DESC`, campaignID)
	if err != nil {
		return nil, nil, nil, err
	}
	state.Journal, err = pgx.CollectRows(sessions, func(r pgx.CollectableRow) (cs.JournalSession, error) {
		var s cs.JournalSession
		var startedAt time.Time
		var endedAt *time.Time
		err := r.Scan(&s.ID, &s.Number, &s.Title, &startedAt, &endedAt, &s.Recap, &s.Notes, &s.Abandoned)
		s.StartedAt, s.EndedAt = core.ISOTime(startedAt), isoPtr(endedAt)
		return s, err
	})
	if err != nil {
		return nil, nil, nil, err
	}
	var sessionID *string
	if len(state.Journal) > 0 && state.Journal[0].EndedAt == nil {
		session := state.Journal[0].Session
		state.Session = &session
		sessionID = &session.ID
	}

	rows, err := actor.LoadRows(ctx, conn, campaignID)
	if err != nil {
		return nil, nil, nil, err
	}
	campaign, err := actor.LoadCampaign(ctx, conn, campaignID, compiled)
	if err != nil {
		return nil, nil, nil, err
	}
	state.Campaign.Fields = map[string]any{}
	maps.Copy(state.Campaign.Fields, campaign)
	built, err := actor.Build(compiled, rows, campaign)
	if err != nil {
		return nil, nil, nil, err
	}
	ledgers, err := actor.LoadLedgers(ctx, conn, campaignID)
	if err != nil {
		return nil, nil, nil, err
	}
	for _, r := range rows {
		live := actor.ToLive(built[r.Actor.ID])
		live.Ledger = ledgers[r.Actor.ID]
		state.Actors = append(state.Actors, live)
	}
	if state.Tests, err = testcall.Load(ctx, conn, campaignID, sessionID, state.Campaign.TableMode != cs.TableModeGM, compiled, built); err != nil {
		return nil, nil, nil, err
	}
	state.TestDefs = testcall.DefsOf(compiled)
	var running bool
	if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM session WHERE campaign_id = $1 AND ended_at IS NULL)`, campaignID).
		Scan(&running); err != nil {
		return nil, nil, nil, err
	}
	if state.Encounter, err = encounter.Load(ctx, conn, campaignID, compiled, built, !running); err != nil {
		return nil, nil, nil, err
	}
	if state.Clocks, err = clock.Load(ctx, conn, campaignID); err != nil {
		return nil, nil, nil, err
	}
	if state.Requests, err = request.Load(ctx, conn, campaignID); err != nil {
		return nil, nil, nil, err
	}
	if state.RequestAnswers, err = request.LoadAnswers(ctx, conn, campaignID); err != nil {
		return nil, nil, nil, err
	}
	if state.Rolls, err = randomtable.LoadRolls(ctx, conn, campaignID, compiled); err != nil {
		return nil, nil, nil, err
	}
	if state.Dealt, err = randomtable.LoadDealt(ctx, conn, campaignID, compiled); err != nil {
		return nil, nil, nil, err
	}
	if state.Games, err = game.Load(ctx, conn, campaignID); err != nil {
		return nil, nil, nil, err
	}
	if state.Pools, err = loadPools(ctx, conn, campaignID, compiled, rows, campaign); err != nil {
		return nil, nil, nil, err
	}
	if state.Access, err = loadAccess(ctx, conn, campaignID); err != nil {
		return nil, nil, nil, err
	}
	// ponytail: every draft in the room is reloaded on each broadcast, load only connected users' drafts if it shows.
	drafts, err := actor.LoadDrafts(ctx, conn, campaignID)
	if err != nil {
		return nil, nil, nil, err
	}
	return &state, compiled, drafts, nil
}

// loadPools is every pool the pinned ruleset declares, in manifest order, with its value (the minimum without a row).
// A pool's bounds may read the campaign's values, so the record in play is passed in.
// Empty without a ruleset; a pool whose bounds cannot be evaluated is left out.
func loadPools(ctx context.Context, conn core.Conn, campaignID string, compiled *engine.CompiledRuleset, rows []actor.Rows, campaign map[string]any) ([]cs.PoolState, error) {
	out := []cs.PoolState{}
	if compiled == nil {
		return out, nil
	}
	stored, err := actor.LoadPools(ctx, conn, campaignID)
	if err != nil {
		return nil, err
	}
	pools, err := actor.BuildPools(compiled, stored, actor.CountCharacters(rows), campaign)
	if err != nil {
		return nil, err
	}
	built := map[string]actor.Pool{}
	for _, p := range pools {
		built[p.ID] = p
	}
	for _, def := range compiled.Ruleset.Resources {
		p, ok := built[def.ID]
		if !ok {
			continue
		}
		out = append(out, cs.PoolState{
			ID: def.ID, Label: def.Label, Scope: p.Scope, Value: p.State.Value, Min: p.State.Min, Max: p.Bounds.Max,
			Capped: !p.Bounds.Uncapped, Visibility: def.Visibility, EditableBy: def.EditableBy,
		})
	}
	return out, nil
}

func loadAccess(ctx context.Context, conn core.Conn, campaignID string) (cs.Access, error) {
	access := cs.Access{Members: []cs.Member{}, Invites: []cs.Invite{}, Guests: []cs.Guest{}}
	rows, err := conn.Query(ctx, `SELECT m.user_id, app_user.name, m.role, m.scopes,
		coalesce((SELECT array_agg(mc.actor_id::text) FROM membership_character mc WHERE mc.membership_id = m.id), '{}')
		FROM membership m JOIN app_user ON app_user.id = m.user_id WHERE m.campaign_id = $1 ORDER BY m.created_at`, campaignID)
	if err != nil {
		return access, err
	}
	members, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.Member, error) {
		var m cs.Member
		err := r.Scan(&m.UserID, &m.Name, &m.Role, &m.Scopes, &m.CharacterIDs)
		if m.Scopes == nil {
			m.Scopes = []string{}
		}
		if m.CharacterIDs == nil {
			m.CharacterIDs = []string{}
		}
		return m, err
	})
	if err != nil {
		return access, err
	}
	access.Members = append(access.Members, members...)

	rows, err = conn.Query(ctx, `SELECT id::text, mode, role, actor_id::text, allow_guests, expires_at, uses, max_uses FROM invite
		WHERE campaign_id = $1 AND revoked_at IS NULL AND expires_at > now()`, campaignID)
	if err != nil {
		return access, err
	}
	invites, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (cs.Invite, error) {
		var i cs.Invite
		var expiresAt time.Time
		err := r.Scan(&i.ID, &i.Mode, &i.Role, &i.ActorID, &i.AllowGuests, &expiresAt, &i.Uses, &i.MaxUses)
		i.ExpiresAt = core.ISOTime(expiresAt)
		return i, err
	})
	if err != nil {
		return access, err
	}
	access.Invites = append(access.Invites, invites...)

	rows, err = conn.Query(ctx, `SELECT DISTINCT actor_id::text FROM access_token
		WHERE campaign_id = $1 AND role = 'player' AND revoked_at IS NULL AND actor_id IS NOT NULL`, campaignID)
	if err != nil {
		return access, err
	}
	guests, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return access, err
	}
	for _, id := range guests {
		access.Guests = append(access.Guests, cs.Guest{ActorID: id})
	}

	if err := conn.QueryRow(ctx, `SELECT count(*) FROM access_token WHERE campaign_id = $1 AND role = 'screen' AND revoked_at IS NULL`,
		campaignID).Scan(&access.Screens); err != nil {
		return access, err
	}

	var t cs.Transfer
	var expiresAt time.Time
	err = conn.QueryRow(ctx, `SELECT to_user_id, expires_at FROM ownership_transfer WHERE campaign_id = $1 AND expires_at > now()`,
		campaignID).Scan(&t.ToUserID, &expiresAt)
	if err == nil {
		t.ExpiresAt = core.ISOTime(expiresAt)
		access.Transfer = &t
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return access, err
	}
	return access, nil
}

// LoadSnapshot is both snapshots with their ruleset. Nil for a gone campaign.
func LoadSnapshot(ctx context.Context, conn core.Conn, campaignID string) (*Loaded, error) {
	state, compiled, drafts, err := LoadLive(ctx, conn, campaignID)
	if err != nil || state == nil {
		return nil, err
	}
	c, err := codex.Load(ctx, conn, campaignID)
	if err != nil {
		return nil, err
	}
	return &Loaded{view.Snapshot{State: *state, Codex: c, Drafts: drafts}, compiled}, nil
}
