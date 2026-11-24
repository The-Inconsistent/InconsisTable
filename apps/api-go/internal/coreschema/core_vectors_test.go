package coreschema

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

type coreVectors struct {
	Refusals map[string]string `json:"refusals"`
	Messages []struct {
		Code   string `json:"code"`
		Params Params `json:"params"`
		Body   any    `json:"body"`
	} `json:"messages"`
	Permissions []struct {
		Ctx struct {
			UserID          *string `json:"userId"`
			CampaignOwnerID *string `json:"campaignOwnerId"`
			TableMode       string  `json:"tableMode"`
			Seat            struct {
				Kind         SeatKind `json:"kind"`
				Role         string   `json:"role"`
				Scopes       []string `json:"scopes"`
				CharacterIDs []string `json:"characterIds"`
			} `json:"seat"`
		} `json:"ctx"`
		Can      map[string]bool `json:"can"`
		OwnOK    map[string]bool `json:"ownOk"`
		ActOn    map[string]bool `json:"actOn"`
		Grant    map[string]bool `json:"grant"`
		SeatJSON any             `json:"seatJson"`
	} `json:"permissions"`
	GMPerm       map[string]string `json:"gmPerm"`
	AdminActions []string          `json:"adminActions"`
	Shapes       []struct {
		Shape  string `json:"shape"`
		Input  any    `json:"input"`
		Ok     bool   `json:"ok"`
		Output any    `json:"output"`
		Pretty string `json:"pretty"`
	} `json:"shapes"`
}

func load(t *testing.T) coreVectors {
	t.Helper()
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatalf("no vectors, run `bun run test:go` from the repo root: %v", err)
	}
	var v coreVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Refusals) == 0 || len(v.Permissions) == 0 || len(v.Shapes) == 0 || len(v.Messages) == 0 {
		t.Fatal("vectors are empty, so this test would prove nothing")
	}
	return v
}

func viaJSON(t *testing.T, v any) any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestAdminActionsMatchTypeScript(t *testing.T) {
	if v := load(t); !reflect.DeepEqual(AdminActions, v.AdminActions) {
		t.Fatalf("want %v, got %v", v.AdminActions, AdminActions)
	}
}

func TestRefusalsMatchTypeScript(t *testing.T) {
	v := load(t)
	if !reflect.DeepEqual(refusals, v.Refusals) {
		for code, text := range v.Refusals {
			if refusals[code] != text {
				t.Errorf("%s: want %q, got %q", code, text, refusals[code])
			}
		}
		for code := range refusals {
			if _, ok := v.Refusals[code]; !ok {
				t.Errorf("%s is not in TypeScript", code)
			}
		}
	}
	for _, x := range v.Messages {
		if got := viaJSON(t, RefusalBody(x.Code, x.Params)); !reflect.DeepEqual(got, x.Body) {
			t.Errorf("%s: want %v, got %v", x.Code, x.Body, got)
		}
	}
}

func TestPermissionsMatchTypeScript(t *testing.T) {
	v := load(t)
	for i, x := range v.Permissions {
		c := Ctx{"c", x.Ctx.UserID, x.Ctx.CampaignOwnerID, x.Ctx.TableMode, Seat{x.Ctx.Seat.Kind, x.Ctx.Seat.Role, x.Ctx.Seat.Scopes, x.Ctx.Seat.CharacterIDs}}
		for perm, want := range x.Can {
			if got := CanInCampaign(c, perm, ""); got != want {
				t.Errorf("case %d %s: want %v, got %v", i, perm, want, got)
			}
		}
		for perm, want := range x.OwnOK {
			if got := CanInCampaign(c, perm, "held"); got != want {
				t.Errorf("case %d own %s: want %v, got %v", i, perm, want, got)
			}
		}
		for key, want := range x.ActOn {
			target := map[string][2]string{"owner": {"owner", "gm"}, "gm": {"u9", "gm"}, "cogm": {"u9", "cogm"}, "player": {"u9", "player"}}[key]
			if got := CanActOnMember(c, target[0], target[1]); got != want {
				t.Errorf("case %d act on %s: want %v, got %v", i, key, want, got)
			}
		}
		for role, want := range x.Grant {
			if got := CanGrantRole(c, role); got != want {
				t.Errorf("case %d grant %s: want %v, got %v", i, role, want, got)
			}
		}
		if got := viaJSON(t, c.Seat); !reflect.DeepEqual(got, x.SeatJSON) {
			t.Errorf("case %d seat: want %v, got %v", i, x.SeatJSON, got)
		}
	}
	for kind, want := range v.GMPerm {
		if got := GMPermOf(kind); got != want {
			t.Errorf("%s: want %s, got %s", kind, want, got)
		}
	}
}

func TestShapesMatchTypeScript(t *testing.T) {
	v := load(t)
	shapes := map[string]schema.Schema{
		"CampaignID": CampaignID, "CreateGame": CreateGame, "AdminCreate": AdminCreate, "Rename": Rename, "RenameAccount": RenameAccount, "Join": Join,
	}
	for i, x := range v.Shapes {
		out, issues := schema.Parse(shapes[x.Shape], x.Input)
		switch {
		case x.Ok && len(issues) > 0:
			t.Errorf("case %d %s %v: want it accepted, got %v", i, x.Shape, x.Input, issues)
		case !x.Ok && schema.Prettify(issues) != x.Pretty:
			t.Errorf("case %d %s %v:\n  want %q\n  got  %q", i, x.Shape, x.Input, x.Pretty, schema.Prettify(issues))
		case x.Ok && !reflect.DeepEqual(viaJSON(t, out), x.Output):
			t.Errorf("case %d %s: want %v, got %v", i, x.Shape, x.Output, out)
		}
	}
}

// The notice codes and their params are core-schema's (house decision #79), and each constructor fills exactly those.
func TestNoticesMatchTypeScript(t *testing.T) {
	raw, err := os.ReadFile("testdata/vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		NoticeParams map[string][]string `json:"noticeParams"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(v.NoticeParams, NoticeParams) {
		t.Fatalf("want %v, got %v", v.NoticeParams, NoticeParams)
	}
	for _, n := range []Notice{PoolFull("Luck", 2), RestSkipped([]string{"Ash", "Bo"}), RuleNotice("unspent", "Ash", "Ash has boons"),
		SessionDeleted(3), SceneBegun("Gate", 2), RevealSkipped("Map", "entryNotFound")} {
		keys := []string{}
		for _, k := range NoticeParams[n.Code] {
			if _, ok := n.Params[k]; ok {
				keys = append(keys, k)
			}
		}
		if len(keys) != len(n.Params) || len(keys) != len(NoticeParams[n.Code]) {
			t.Errorf("%s: params %v, want %v", n.Code, n.Params, NoticeParams[n.Code])
		}
	}
}
