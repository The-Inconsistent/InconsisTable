package table

import (
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// The review fixes of the table modes (docs/adr/0009-table-modes.md).

// attachPack attaches a pack of two creature entries, one for the table and one for the GM, and returns its version.
func (p *play) attachPack() string {
	p.t.Helper()
	tx, room := p.tx, p.room
	rulesetVersion := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
	rs := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
	pack := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-spawn', $2, 'private')
		RETURNING id::text`, room.Owner, rs)
	version := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
		VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 2, 0) RETURNING id::text`, pack, rulesetVersion)
	for key, visibility := range map[string]string{"wolf": "public", "lich": "gm"} {
		dbtest.Exec(p.t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body)
			VALUES ($1, $2, 'character', $2, '{}', $3, 'Fixture p.1', 'h', '{"level": 3}')`, version, key, visibility)
	}
	dbtest.Exec(p.t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, room.ID, version)
	return version
}

func TestOnlyTheOwnerAnnouncesABookWithoutAGM(t *testing.T) {
	owner, other := "owner", "other"
	seat := func(userID *string, kind cs.SeatKind, role, mode string) cs.Ctx {
		return cs.Ctx{UserID: userID, CampaignOwnerID: &owner, TableMode: mode, Seat: cs.Seat{Kind: kind, Role: role}}
	}
	for name, c := range map[string]struct {
		ctx  cs.Ctx
		want bool
	}{
		"the GM with a GM":          {seat(&owner, cs.SeatMember, "gm", "gm"), true},
		"a player with a GM":        {seat(&other, cs.SeatMember, "player", "gm"), false},
		"the owner without a GM":    {seat(&owner, cs.SeatMember, "player", "gmless"), true},
		"the owner, alone":          {seat(&owner, cs.SeatMember, "player", "solo"), true},
		"another player, no GM":     {seat(&other, cs.SeatMember, "player", "gmless"), false},
		"a guest, no GM":            {seat(nil, cs.SeatToken, "player", "gmless"), false},
		"a stale GM seat, no GM":    {seat(&other, cs.SeatMember, "gm", "gmless"), false},
		"a stale GM seat, no GM #2": {seat(&other, cs.SeatMember, "cogm", "solo"), false},
	} {
		if got := mayServeBooks(c.ctx); got != c.want {
			t.Errorf("%s: mayServeBooks = %v", name, got)
		}
	}
}

// A `gm` pack entry is read by the GM side only: without a GM nobody spawns one, and the refusal is the one for a key the
// pack lacks, so it does not tell which gm keys exist.
func TestSpawnReadsGMEntriesOnlyForAGMSide(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		version := p.attachPack()
		spawn := func(key string) map[string]any {
			return map[string]any{"type": "actor.spawn", "packVersionId": version, "key": key, "count": 1.0}
		}
		p.startSession()
		p.send(gm, spawn("lich"))

		p.send(gm, map[string]any{"type": "session.end"})
		p.setMode(gm, "gmless")
		owner := gm
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player"}
		p.send(owner, map[string]any{"type": "session.start"})
		p.refused(owner, spawn("lich"), "entryNotInPack")
		p.refused(owner, spawn("nothere"), "entryNotInPack")
		p.send(owner, spawn("wolf"))
	})
}
