package table

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// build.save end to end (house decision #63), against the invented ledger ruleset and its pack as the vectors carry
// them (vectors/generate.ts, ledgerPacks). The ruleset and the pack are imported for real, so they are committed under
// a user of the test's own; each test's room and actions run in a rolled-back transaction.

// Builds of the invented catalogue (packages/rules-engine/src/build/fixtures/sample-ledger.ts), keys in an order of
// their own, not the schema's. dreamBuild is ready as it is; rootsBuild needs the GM to approve oldRite.
const (
	dreamBuild = `{"skills":{"Lore":3,"Brawl":1},"tier":1,"archetypeId":"lamplighter","fills":{"[GUILD]":{"id":"ironhand"}},` +
		`"background":{"tableId":"warden-roots","roots":"Lowland","deed":"Held the Gate","dream":"A Quiet Hearth","bonus":"dream"},` +
		`"languages":{"picks":["trade-tongue"]},"wealth":1}`
	rootsBuild = `{"tier":1,"archetypeId":"lamplighter","fills":{"[GUILD]":{"id":"ironhand"}},` +
		`"background":{"tableId":"warden-roots","roots":"Lowland","deed":"Held the Gate","dream":"A Quiet Hearth","bonus":"roots"},` +
		`"languages":{"picks":["trade-tongue"]},"skills":{"Brawl":1}%s}`
	oldRite = "archetype/lamplighter/0/requires/kindskillskillloremin3"
)

var ledgerUsers int

type ledgerLibrary struct {
	owner, rulesetVersion, packVersion string
}

// importLedger imports the ledger ruleset and its pack as a new user's, committed, and removes them after the test.
func importLedger(t *testing.T, db *pgxpool.Pool) ledgerLibrary {
	t.Helper()
	raw, err := os.ReadFile("../engine/testdata/vectors.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v struct {
		LedgerPacks struct {
			Rulesets []map[string]any `json:"rulesets"`
			Cases    []struct {
				Input json.RawMessage `json:"input"`
			} `json:"cases"`
		} `json:"ledgerPacks"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	ledgerUsers++
	owner := fmt.Sprintf("test-ledger-%d-%d", os.Getpid(), ledgerUsers)
	if _, err := db.Exec(ctx, `INSERT INTO app_user (id, name) VALUES ($1, $1)`, owner); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, sql := range []string{`DELETE FROM pack WHERE owner_user_id = $1`, `DELETE FROM ruleset WHERE owner_user_id = $1`,
			`DELETE FROM app_user WHERE id = $1`} {
			_, _ = db.Exec(ctx, sql, owner)
		}
	})
	rs, err := ruleset.Import(ctx, db, owner, v.LedgerPacks.Rulesets[0])
	if err != nil {
		t.Fatal(err)
	}
	doc, err := schema.DecodeJSON(v.LedgerPacks.Cases[0].Input) // the sample pack as it is
	if err != nil {
		t.Fatal(err)
	}
	p, err := pack.Import(ctx, db, owner, doc)
	if err != nil {
		t.Fatal(err)
	}
	return ledgerLibrary{owner, rs.VersionID, p.VersionID}
}

// ledgerPlay is a room of the library's owner, as its GM, with the ledger ruleset pinned and the pack attached.
func ledgerPlay(t *testing.T, tx pgx.Tx, lib ledgerLibrary) *play {
	t.Helper()
	id := dbtest.Scalar[string](t, tx, `INSERT INTO campaign (name, owner_user_id, ruleset_version_id) VALUES ('Ledger', $1, $2)
		RETURNING id::text`, lib.owner, lib.rulesetVersion)
	dbtest.Exec(t, tx, `INSERT INTO membership (campaign_id, user_id, role) VALUES ($1, $2, 'gm')`, id, lib.owner)
	dbtest.Exec(t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, id, lib.packVersion)
	return &play{t, tx, dbtest.Room{ID: id, Owner: lib.owner}}
}

func save(actorID, build string) map[string]any {
	return map[string]any{"type": "build.save", "actorId": actorID, "build": build}
}

func (p *play) refusedWith(c cs.Ctx, action map[string]any, code string) *cs.Error {
	p.t.Helper()
	_, err := p.try(c, action)
	var refusal *cs.Error
	if !errors.As(err, &refusal) || refusal.Code != code {
		p.t.Fatalf("%v: want %s, got %v", action["type"], code, err)
	}
	return refusal
}

// The stored documents of an actor, as text.
func (p *play) stored(actorID string) (build, sheet string) {
	p.t.Helper()
	if err := p.tx.QueryRow(context.Background(), `SELECT build::text, sheet::text FROM actor_build WHERE actor_id = $1`, actorID).
		Scan(&build, &sheet); err != nil {
		p.t.Fatal(err)
	}
	return build, sheet
}

// The actor's field rows: an int field as its number, a text field as its text, a list as its items joined by ",".
func (p *play) fields(actorID string) map[string]any {
	p.t.Helper()
	rows, err := p.tx.Query(context.Background(), `SELECT field_id, int_value, text_value FROM actor_field WHERE actor_id = $1
		ORDER BY field_id, ordinal`, actorID)
	if err != nil {
		p.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]any{}
	for rows.Next() {
		var field string
		var n *int
		var text *string
		if err := rows.Scan(&field, &n, &text); err != nil {
			p.t.Fatal(err)
		}
		switch prev, listed := out[field]; {
		case n != nil:
			out[field] = *n
		case listed:
			out[field] = prev.(string) + "," + *text
		default:
			out[field] = *text
		}
	}
	return out
}

func (p *play) resources(actorID string) map[string]int {
	p.t.Helper()
	rows, err := p.tx.Query(context.Background(), `SELECT resource_id, value FROM actor_resource WHERE actor_id = $1`, actorID)
	if err != nil {
		p.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var v int
		if err := rows.Scan(&id, &v); err != nil {
			p.t.Fatal(err)
		}
		out[id] = v
	}
	return out
}

func TestALedgerBuildIsResolvedAndSavedWithItsFieldsResourcesAndDocuments(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
		p.send(ana, save(hero, dreamBuild))

		if typ := dbtest.Scalar[string](t, tx, `SELECT entity_type FROM actor WHERE id = $1`, hero); typ != "hero" {
			t.Fatalf("typed as %q", typ)
		}
		want := map[string]any{
			"attr.mgt": 2, "attr.agi": 3, "attr.wit": 3, "attr.pre": 2,
			"skill.brawl": 1, "skill.climb": 0, "skill.sneak": 2, "skill.dodge": 0, "skill.lore": 3, "skill.craft": 0,
			"skill.charm": 0, "skill.command": 0,
			"mod.maxHealth": 0, "mod.maxNerve": 1, "mod.guard": 2, "mod.grit": 0, "mod.influence": 0, "mod.speed": 0,
			"mod.notice":   0,
			"armourRating": 2, "powered": 0, "speed": 6, "species": "Heron-kin", "archetype": "Lamplighter",
			"keywords": "WARDEN,IRONHAND",
		}
		if got := p.fields(hero); fmt.Sprint(got) != fmt.Sprint(want) {
			t.Fatalf("field rows\n got %v\nwant %v", got, want)
		}
		// The first save starts the resources, Wealth and Corruption at the sheet's values.
		if got := p.resources(hero); got["wealth"] != 3 || got["corruption"] != 1 {
			t.Fatalf("resources %v", got)
		}
		build, sheet := p.stored(hero)
		// The build is kept as it came, key for key; a player's save gets the GM's part (none yet) at the end. The sheet is
		// in the builder's order.
		if want := strings.TrimSuffix(dreamBuild, "}") + `,"gm":{}}`; build != want {
			t.Fatalf("stored build\n got %s\nwant %s", build, want)
		}
		if !strings.HasPrefix(sheet, `{"species":"Heron-kin","archetype":"Lamplighter","keywords":["WARDEN","IRONHAND"],"attributes":{"MGT":2,`) {
			t.Fatalf("stored sheet %s", sheet)
		}

		// The GM and the seat holding the character receive the documents as stored, keys in order; another player not.
		bo := p.room.Seat(t, tx, dbtest.User(t, tx, "Bo"))
		for _, seat := range []cs.Ctx{gm, ana, bo} {
			var got *cs.Actor
			for _, a := range p.seatView(seat).State.Actors {
				if a.ID == hero {
					got = &a
				}
			}
			if seat.UserID == bo.UserID {
				if got == nil || got.Ledger != nil {
					t.Fatalf("a player not holding the character: %+v", got)
				}
				continue
			}
			if got == nil || got.Ledger == nil || string(got.Ledger.Build) != build || string(got.Ledger.Sheet) != sheet {
				t.Fatalf("as %s: %+v", seat.Seat.Role, got)
			}
			// Sent as it is: the socket writes the state with encoding/json.
			if out, _ := json.Marshal(got.Ledger); !strings.HasPrefix(string(out), `{"build":`+build+`,"sheet":{"species"`) {
				t.Fatalf("sent %s", out)
			}
		}

		// Play changes a resource; a second save replaces the documents and the fields and leaves the resources alone.
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 7 WHERE actor_id = $1 AND resource_id = 'wealth'`, hero)
		second := fmt.Sprintf(rootsBuild, `,"gm":{"approved":["`+oldRite+`"]}`)
		p.send(gm, save(hero, second))
		// The GM's save is kept byte for byte.
		if build, _ := p.stored(hero); build != second {
			t.Fatalf("the second save stored %s", build)
		}
		if got := p.fields(hero); got["skill.lore"] != 1 || got["mod.guard"] != 3 {
			t.Fatalf("the second save's fields: %v", got)
		}
		if got := p.resources(hero); got["wealth"] != 7 || got["corruption"] != 1 {
			t.Fatalf("a later save changed the resources: %v", got)
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM actor_build WHERE actor_id = $1`, hero); n != 1 {
			t.Fatalf("%d rows", n)
		}
	})
}

func TestAPlayersSaveKeepsTheGMsPartOfTheBuild(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "hero")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)

		// A player cannot approve the GM's question: the approval is dropped, so the build is not ready.
		approved := fmt.Sprintf(rootsBuild, `,"gm":{"approved":["`+oldRite+`"],"mods":{"guard":5}}`)
		refusal := p.refusedWith(ana, save(hero, approved), "buildNotReady")
		if detail, _ := refusal.Params["detail"].(string); !strings.Contains(detail, "Old Rite (granted): needs Lore 3 (for the GM to approve)") {
			t.Fatalf("detail %q", detail)
		}
		// The GM approves; the player saves again, sending GM rulings of their own: the GM's stand.
		gmPart := `{"approved":["` + oldRite + `"]}`
		p.send(gm, save(hero, fmt.Sprintf(rootsBuild, `,"gm":`+gmPart)))
		p.send(ana, save(hero, approved))
		build, _ := p.stored(hero)
		if want := fmt.Sprintf(rootsBuild, `,"gm":`+gmPart); build != want {
			t.Fatalf("stored\n got %s\nwant %s", build, want)
		}
		if got := p.fields(hero)["mod.guard"]; got != 3 {
			t.Fatalf("guard %v", got)
		}
		// Without a gm part at all, the stored one is added.
		p.send(ana, save(hero, fmt.Sprintf(rootsBuild, "")))
		if build, _ := p.stored(hero); !strings.HasSuffix(build, `"gm":`+gmPart+`}`) {
			t.Fatalf("stored %s", build)
		}
	})
}

func TestBuildSaveRefusals(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "")

		// A type the builder doesn't build.
		other := p.room.Actor(t, tx, "pc", "Item", "keyword")
		p.refused(gm, save(other, dreamBuild), "notLedgerBuilt")
		// Values written another way.
		filled := p.room.Actor(t, tx, "pc", "Filled", "hero")
		dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'xp', 0, 3)`, filled)
		p.refused(gm, save(filled, dreamBuild), "alreadyBuilt")
		// Not the room's Tier.
		refusal := p.refusedWith(gm, save(hero, strings.Replace(dreamBuild, `"tier":1`, `"tier":2`, 1)), "buildTierMismatch")
		if refusal.Params["tier"] != 2.0 || refusal.Params["gameTier"] != 1.0 {
			t.Fatalf("params %v", refusal.Params)
		}
		// Text that is not a build.
		for _, text := range []string{"not json", "[1]", `{"tier":1}`, `{"tier":1,"archetypeId":"lamplighter","advanced":{}}`} {
			refusal := p.refusedWith(gm, save(hero, text), "buildInvalid")
			if detail, _ := refusal.Params["detail"].(string); detail == "" {
				t.Fatalf("%s: no detail", text)
			}
		}
		// Choices still to make.
		refusal = p.refusedWith(gm, save(hero, `{"tier":1,"archetypeId":"lamplighter"}`), "buildNotReady")
		detail, _ := refusal.Params["detail"].(string)
		for _, line := range []string{"Old Rite (granted): needs Lore 3 (for the GM to approve)", "background: Choose a Background table",
			"fill/guild: Choose your [GUILD]", "languages: Choose 1 free language"} {
			if !strings.Contains(detail, line) {
				t.Fatalf("detail %q lacks %q", detail, line)
			}
		}
		// Nothing was written by a refusal.
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM actor_build`); n != 0 {
			t.Fatalf("%d builds stored", n)
		}

		// A ruleset without a ledger builder.
		plain := newPlay(t, tx)
		actor := plain.room.Actor(t, tx, "pc", "Ash", "character")
		plain.refused(plain.room.GM(), save(actor, dreamBuild), "notLedgerBuilt")
		// A player may save only a character they hold.
		bo := p.room.Seat(t, tx, dbtest.User(t, tx, "Bo"))
		p.refused(bo, save(hero, dreamBuild), "notYourCharacter")
	})
}

func TestTheCatalogueIsTheServedPacksRecords(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		ctx := context.Background()
		rules := dbtest.Must[*engine.CompiledRuleset](t)(compiled.Load(ctx, tx, p.room.ID))
		c := dbtest.Must[*pack.Catalogue](t)(pack.LoadCatalogue(ctx, tx, p.room.ID, rules.Build))
		if len(c.Kinds) != 12 || len(c.Kinds["archetypes"]) == 0 || len(c.Wargear) == 0 {
			t.Fatalf("kinds %d, archetypes %d, wargear %d", len(c.Kinds), len(c.Kinds["archetypes"]), len(c.Wargear))
		}
		// Records keep their pack's order and their stored keys' order.
		first, _ := schema.AppendJSON(nil, c.Kinds["keywords"][0])
		stored := dbtest.Scalar[string](t, tx, `SELECT record::text FROM pack_entry WHERE pack_version_id = $1 AND key = 'keywords.guild-keyword'`,
			lib.packVersion)
		if string(first) != stored {
			t.Fatalf("first keyword\n got %s\nwant %s", first, stored)
		}
		if _, err := c.Ledger(rules.Build.Params); err != nil {
			t.Fatal(err)
		}

		// A pack taken down by an admin serves nothing, so the build no longer resolves.
		dbtest.Exec(t, tx, `UPDATE pack SET disabled_at = now() WHERE id = (SELECT pack_id FROM pack_version WHERE id = $1)`, lib.packVersion)
		c = dbtest.Must[*pack.Catalogue](t)(pack.LoadCatalogue(ctx, tx, p.room.ID, rules.Build))
		if len(c.Kinds["archetypes"]) != 0 || len(c.Wargear) != 0 {
			t.Fatalf("a taken-down pack is served: %d archetypes", len(c.Kinds["archetypes"]))
		}
		hero := p.room.Actor(t, tx, "pc", "Wren", "")
		p.refused(p.room.GM(), save(hero, dreamBuild), "buildNotReady")
	})
}

// The actor's stored draft as text; nil when the row holds none. built says whether it holds a build.
func (p *play) draftOf(actorID string) (draft *string, built bool) {
	p.t.Helper()
	if err := p.tx.QueryRow(context.Background(), `SELECT draft::text, build IS NOT NULL FROM actor_build WHERE actor_id = $1`, actorID).
		Scan(&draft, &built); err != nil {
		p.t.Fatal(err)
	}
	return draft, built
}

func draftSave(actorID, build string) map[string]any {
	a := save(actorID, build)
	a["draft"] = true
	return a
}

func TestALedgerDraftIsStoredUnresolvedForTheGMToOpen(t *testing.T) {
	db := dbtest.Open(t)
	lib := importLedger(t, db)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		p := ledgerPlay(t, tx, lib)
		gm := p.room.GM()
		hero := p.room.Actor(t, tx, "pc", "Wren", "")
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hero)
		bo := p.room.Seat(t, tx, dbtest.User(t, tx, "Bo"))

		// A player's draft, waiting for the GM's approval: stored as sent, the GM's part (none yet) in place of theirs,
		// and nothing of the actor written.
		p.send(ana, draftSave(hero, fmt.Sprintf(rootsBuild, `,"gm":{"approved":["`+oldRite+`"]}`)))
		draft, built := p.draftOf(hero)
		if want := fmt.Sprintf(rootsBuild, `,"gm":{}`); draft == nil || *draft != want || built {
			t.Fatalf("draft %v (built %v)\nwant %s", draft, built, want)
		}
		if typ := dbtest.Scalar[string](t, tx, `SELECT entity_type FROM actor WHERE id = $1`, hero); typ != "" {
			t.Fatalf("a draft typed the actor %q", typ)
		}
		if f, r := p.fields(hero), p.resources(hero); len(f) != 0 || len(r) != 0 {
			t.Fatalf("a draft wrote fields %v, resources %v", f, r)
		}

		// The GM and the holder receive it; another player does not.
		for _, seat := range []cs.Ctx{gm, ana, bo} {
			for _, a := range p.seatView(seat).State.Actors {
				if a.ID != hero {
					continue
				}
				if seat.UserID == bo.UserID {
					if a.Ledger != nil {
						t.Fatalf("another player receives the draft: %+v", a.Ledger)
					}
					continue
				}
				if a.Ledger == nil || string(a.Ledger.Draft) != *draft || a.Ledger.Build != nil || a.Ledger.Sheet != nil {
					t.Fatalf("as %s: %+v", seat.Seat.Role, a.Ledger)
				}
				if out, _ := json.Marshal(a.Ledger); string(out) != `{"build":null,"sheet":null,"draft":`+*draft+`}` {
					t.Fatalf("sent %s", out)
				}
			}
		}

		// The GM approves in a draft of their own; the player's next draft keeps the approval.
		gmPart := `{"approved":["` + oldRite + `"]}`
		p.send(gm, draftSave(hero, fmt.Sprintf(rootsBuild, `,"gm":`+gmPart)))
		p.send(ana, draftSave(hero, fmt.Sprintf(rootsBuild, `,"gm":{}`)))
		if draft, _ := p.draftOf(hero); *draft != fmt.Sprintf(rootsBuild, `,"gm":`+gmPart) {
			t.Fatalf("the player's draft lost the GM's part: %s", *draft)
		}

		// The same checks as a save, short of resolving; a draft that is not ready is no refusal.
		p.refused(ana, draftSave(hero, "not json"), "buildInvalid")
		p.refused(ana, draftSave(hero, `{"tier":2}`), "buildTierMismatch")
		p.refused(bo, draftSave(hero, `{"tier":1}`), "notYourCharacter")
		p.send(ana, draftSave(hero, `{"tier":1,"archetypeId":"lamplighter"}`))

		// A draft alone is no character filled another way: the player's ready save, with the GM's approval kept from
		// the GM's draft, types the actor, writes its fields, starts its resources and clears the draft.
		p.send(gm, draftSave(hero, fmt.Sprintf(rootsBuild, `,"gm":`+gmPart)))
		p.send(ana, save(hero, fmt.Sprintf(rootsBuild, "")))
		draft, built = p.draftOf(hero)
		if draft != nil || !built {
			t.Fatalf("after a ready save: draft %v, built %v", draft, built)
		}
		if build, _ := p.stored(hero); build != fmt.Sprintf(rootsBuild, `,"gm":`+gmPart) {
			t.Fatalf("stored %s", build)
		}
		if got := p.fields(hero)["mod.guard"]; got != 3 {
			t.Fatalf("guard %v", got)
		}
		if got := p.resources(hero); len(got) == 0 {
			t.Fatalf("the first ready save after a draft did not start the resources: %v", got)
		}

		// A draft of a built character leaves the build and the fields as they are.
		p.send(gm, draftSave(hero, `{"tier":1}`))
		if draft, built := p.draftOf(hero); draft == nil || *draft != `{"tier":1}` || !built {
			t.Fatalf("draft %v, built %v", draft, built)
		}
		if got := p.fields(hero)["mod.guard"]; got != 3 {
			t.Fatalf("guard %v", got)
		}
	})
}
