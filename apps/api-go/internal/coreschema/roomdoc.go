package coreschema

import (
	"fmt"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// A room as one document (packages/core-schema/src/room-document.ts, house decision #74): what a room holds, in the
// platform's own terms. Every id inside it is the document's own; the import gives every row a new one.

// RoomFormat and RoomVersion name the document.
const (
	RoomFormat  = "inconsistable-room"
	RoomVersion = 1
)

// The caps of a room document, as ROOM_LIMITS has them: each is the cap the table's actions hold a room to, or, where
// no action caps a list, the house decision's.
const (
	RoomMaxBytes           = 100 * 1024 * 1024
	roomMaxPacks           = 50
	roomMaxCampaignFields  = 100
	roomMaxPools           = 100
	RoomMaxActors          = 50
	roomMaxActorFields     = 200
	roomMaxActorResources  = 100
	roomMaxActorConditions = 50
	roomMaxActorItems      = 200
	roomMaxCodex           = 1000
	roomMaxLinks           = 100
	roomMaxAudience        = 50
	roomMaxEntryFields     = 20
	roomMaxSessions        = 500
	roomMaxImages          = 200
	roomMaxImageBase64     = 1_333_336
)

func capped(s schema.Schema, limit int, what string) schema.Schema {
	return schema.RefinedSoft(s, func(v any) bool {
		m, _ := schema.Plain(v).(map[string]any)
		return len(m) <= limit
	}, fmt.Sprintf("At most %d %s", limit, what))
}

var (
	roomKey      = schema.String().Min(1).Max(64)
	roomAmount   = schema.Int().Min(-1_000_000).Max(1_000_000)
	roomDateTime = schema.DateTime()

	roomExpect = schema.Object(
		schema.Req("slug", schema.String().Min(1).Max(100)),
		schema.Req("version", schema.String().Min(1).Max(100)),
		schema.Opt("hash", schema.String().Min(1).Max(128)),
	).Strict()

	roomItem = schema.Object(
		schema.Req("id", id),
		schema.Req("kind", roomKey),
		schema.Opt("entry", schema.String().Min(1).Max(80)),
		schema.Opt("name", schema.String().Trim().Min(1).Max(120)),
		schema.Opt("note", schema.String().Max(200)),
		schema.Opt("quantity", schema.Int().Min(1).Max(999)),
		schema.Opt("fittedTo", id),
		schema.Opt("source", schema.Enum("give", "hand", "acquire")),
		schema.Opt("entryId", id),
	).Strict()

	roomActor = schema.RefinedSoft(schema.Object(
		schema.Req("id", id),
		schema.Req("kind", schema.Enum(actorKinds...)),
		schema.Req("name", actorName),
		schema.Opt("entityType", schema.String().Min(1).Max(64)),
		schema.Opt("fields", capped(schema.Record(schema.String().Min(1).Max(120), fieldValue), roomMaxActorFields, "fields")),
		schema.Opt("resources", capped(schema.Record(roomKey, roomAmount), roomMaxActorResources, "resources")),
		schema.Opt("build", LedgerBuildText),
		schema.Opt("conditions", schema.Array(roomKey).Max(roomMaxActorConditions)),
		schema.Opt("items", schema.Array(roomItem).Max(roomMaxActorItems)),
	).Strict(), func(v any) bool {
		a, _ := v.(map[string]any)
		_, built := a["build"]
		_, typed := a["entityType"]
		return !built || !typed
	}, "A built character takes its type from its build")

	roomEntry = schema.Object(
		schema.Req("id", id),
		schema.Req("kind", schema.Enum(codexKinds...)),
		schema.Req("title", schema.String().Trim().Min(1).Max(200)),
		schema.Opt("body", schema.String().Max(20_000)),
		schema.Opt("gmNotes", schema.String().Max(20_000)),
		schema.Opt("visibility", schema.Enum(codexVisibility...)),
		schema.Opt("audienceMode", schema.Enum(audienceModes...)),
		schema.Opt("audience", schema.Array(id).Max(roomMaxAudience)),
		schema.Opt("parentId", id),
		schema.Opt("position", schema.Int().Min(0).Max(10_000)),
		schema.Opt("links", schema.Array(id).Max(roomMaxLinks)),
		schema.Opt("plannedTests", schema.Array(schema.String().Min(1).Max(100)).Max(10)),
		schema.Opt("status", schema.Enum(entryStatuses...)),
		schema.Opt("fields", capped(schema.Record(roomKey, codexFieldValue), roomMaxEntryFields, "fields")),
		schema.Opt("layout", schema.Enum(engine.HandoutLayouts...)),
		schema.Opt("header", schema.String().Max(120)),
		schema.Opt("prep", ScenePrep),
		schema.Opt("imageId", id),
		schema.Opt("imageRevealed", schema.Bool()),
		schema.Opt("revealedAt", roomDateTime),
	).Strict()

	roomSession = schema.Object(
		schema.Opt("title", sessionTitle),
		schema.Opt("recap", recap),
		schema.Opt("notes", schema.String().Max(10_000)),
	).Strict()

	roomClock = schema.RefinedSoft(schema.Object(
		schema.Req("name", clockName),
		schema.Opt("segments", clockSegments),
		schema.Opt("visibility", schema.Enum(clockVisibility...)),
		schema.Opt("filled", schema.Int().Min(0).Max(12)),
		schema.Opt("entryId", id),
	).Strict(), func(v any) bool {
		c, _ := v.(map[string]any)
		filled, segments := 0.0, 4.0
		if n, ok := c["filled"].(float64); ok {
			filled = n
		}
		if n, ok := c["segments"].(float64); ok {
			segments = n
		}
		return filled <= segments
	}, "A clock is filled past its segments")

	roomImage = schema.Object(
		schema.Req("id", id),
		schema.Req("mime", schema.Enum("image/webp", "image/jpeg")),
		schema.Req("base64", schema.String().Min(1).Max(roomMaxImageBase64)),
	).Strict()

	// RoomDocument is the whole document.
	RoomDocument = schema.SuperRefined(schema.Object(
		schema.Req("format", schema.Literal(RoomFormat)),
		schema.Req("version", schema.Literal(float64(RoomVersion))),
		schema.Opt("exportedAt", roomDateTime),
		schema.Req("room", schema.Object(
			schema.Req("name", campaignName),
			schema.Opt("nextSessionAt", roomDateTime),
			schema.Opt("nextSessionPlace", schema.String().Trim().Max(200)),
			schema.Opt("safety", schema.Object(
				schema.Req("lines", safetyList), schema.Req("veils", safetyList), schema.Req("xCard", schema.Bool()),
			).Strict()),
		).Strict()),
		schema.Opt("expects", schema.Object(
			schema.Opt("ruleset", roomExpect),
			schema.Opt("packs", schema.Array(roomExpect).Max(roomMaxPacks)),
			schema.Opt("world", roomExpect),
		).Strict()),
		schema.Opt("campaignFields", capped(schema.Record(roomKey, schema.AnyOf(
			schema.Int().Min(-2147483648).Max(2147483647), schema.String().Max(100), schema.Bool(),
		)), roomMaxCampaignFields, "campaign fields")),
		schema.Opt("pools", capped(schema.Record(roomKey, roomAmount), roomMaxPools, "pools")),
		schema.Opt("actors", schema.Array(roomActor).Max(RoomMaxActors)),
		schema.Opt("codex", schema.Array(roomEntry).Max(roomMaxCodex)),
		schema.Opt("sessions", schema.Array(roomSession).Max(roomMaxSessions)),
		schema.Opt("clocks", schema.Array(roomClock).Max(MaxClocks)),
		schema.Opt("images", schema.Array(roomImage).Max(roomMaxImages)),
	).Strict(), func(v any) []string {
		d, _ := v.(map[string]any)
		var out []string
		ids := func(key string) []string {
			list, _ := d[key].([]any)
			var got []string
			for _, item := range list {
				m, _ := item.(map[string]any)
				s, _ := m["id"].(string)
				got = append(got, s)
			}
			return got
		}
		repeated := func(xs []string) bool {
			sorted := slices.Clone(xs)
			slices.Sort(sorted)
			return len(slices.Compact(sorted)) != len(xs)
		}
		if repeated(ids("actors")) {
			out = append(out, "Two actors share an id")
		}
		if repeated(ids("codex")) {
			out = append(out, "Two entries share an id")
		}
		if repeated(ids("images")) {
			out = append(out, "Two pictures share an id")
		}
		entries, _ := d["codex"].([]any)
		active := 0
		for _, item := range entries {
			e, _ := item.(map[string]any)
			if e["kind"] == "scene" && e["status"] == "active" {
				active++
			}
		}
		if active > 1 {
			out = append(out, "More than one scene is active")
		}
		return out
	})
)
