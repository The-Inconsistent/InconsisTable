package engine

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine/ledger"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// Limits of docs/design.md §4.6 (storage).
const (
	MaxPackBytes      = 5 * 1024 * 1024
	MaxPackEntries    = 5000
	MaxEntryBodyBytes = 16 * 1024
	MaxEntryEffects   = 20
	// MaxEntryRecordBytes caps a catalogue record as serialised JSON (house decision #62).
	MaxEntryRecordBytes = 32 * 1024
	// A text value in a private pack longer than this draws a warning: it is probably copied, not summarised.
	privateTextWarnChars = 280
)

var packEntrySchema = schema.Object(
	schema.Req("key", schema.String().Max(80).Regex(`^[a-z0-9]+([-_.][a-z0-9]+)*$`, "use lowercase letters, digits and - _ .")),
	schema.Req("type", idSchema),
	schema.Req("name", label(120)),
	schema.Opt("level", schema.Int().Min(0).Max(100)),
	schema.Def("tags", schema.Array(label(40)).Max(20), []any{}),
	schema.Opt("cite", citeSchema),
	schema.Def("visibility", schema.Enum("public", "party", "gm"), "gm"),
	schema.Def("body", schema.Record(fieldIDSchema, fieldValueInput), map[string]any{}),
	schema.Def("effects", schema.Array(effectSchema).Max(MaxEntryEffects), []any{}),
	schema.Opt("record", schema.Record(schema.String(), schema.Unknown())),
)

var packSchema = schema.Object(
	schema.Req("id", rulesetID),
	schema.Req("version", semVer),
	schema.Req("ruleset", schema.Object(schema.Req("id", rulesetID), schema.Req("range", semVerRange))),
	schema.Req("license", schema.Enum("private", "srd", "cc-by", "orc", "original")),
	schema.Opt("attribution", schema.String().Min(1).Max(500)),
	schema.Def("sources", schema.Array(sourceSchema).Max(20), []any{}),
	schema.Req("entries", schema.Array(packEntrySchema).Max(MaxPackEntries)),
)

// PackEntry is one parsed entry.
type PackEntry struct {
	Key        string         `json:"key"`
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Level      *float64       `json:"level"`
	Tags       []string       `json:"tags"`
	Cite       *string        `json:"cite"`
	Visibility string         `json:"visibility"`
	Body       map[string]any `json:"body"`
	// Effects is what an actor that chose the entry gets in its numbers (house decision #61).
	Effects []Effect `json:"effects"`
	// Record is the ledger builder's catalogue record (house decision #62) as its kind's schema answers it, keys in
	// that order; nil when the entry has none.
	Record *schema.Obj `json:"-"`
	// rawRecord is the record as it came, in its order; nil when absent.
	rawRecord *schema.Obj
}

// record checks an entry's catalogue record (house decision #62): there exactly when the entry's type holds a kind
// the ledger builder reads, within the size cap, valid for its kind, and naming the entry's name. It answers
// the parsed record, or nil when there is none or it is refused. The twin of recordOf in pack.ts.
func (p *problems) record(r *Ruleset, entry PackEntry, i int, kind string) *schema.Obj {
	at := fmt.Sprintf("entries[%d]", i)
	if entry.rawRecord == nil {
		if kind != "" {
			p.add(at+".record", `a "%s" needs its record`, entry.Type)
		}
		return nil
	}
	if r.Build == nil || kind == "" {
		p.add(at+".record", `nothing reads a record on a "%s"`, entry.Type)
		return nil
	}
	// One catalogue for every seat, and a saved sheet with no name a player may not read (house decision #63).
	if entry.Visibility == "gm" {
		p.add(at+".visibility", "every seat reads a catalogue record")
	}
	if size := len(CanonicalJSON(entry.rawRecord)); size > MaxEntryRecordBytes {
		p.add(at+".record", "%d bytes, over the cap of %d", size, MaxEntryRecordBytes)
		return nil
	}
	out, issues := schema.Parse(recordSchema(r.Build.Params.Schemas(), kind), entry.rawRecord)
	if len(issues) > 0 {
		for _, issue := range issues {
			p.add(formatPath(append([]any{"entries", i, "record"}, issue.Path...)), "%s", issue.Message)
		}
		return nil
	}
	record := out.(*schema.Obj)
	if name, _ := record.Get("name"); name != entry.Name {
		p.add(at+".record.name", `must be the entry's name "%s"`, entry.Name)
	}
	return record
}

// recordSchema is the builder's schema of one kind of record.
func recordSchema(s *ledger.Schemas, kind string) schema.Schema {
	return map[string]schema.Schema{
		"keywords": s.Keyword, "factions": s.Faction, "sub-factions": s.SubFaction, "species": s.Species,
		"backgrounds": s.BackgroundTable, "option-groups": s.OptionGroup, "archetypes": s.Archetype,
		"talents": s.Talent, "packages": s.Package, "disciplines": s.Discipline, "powers": s.PsychicPower,
		"languages": s.Language, "wargear": s.Wargear,
	}[kind]
}

// jsonField is a key of a decoded object, ordered or not.
func jsonField(v any, key string) (any, bool) {
	if o, ok := v.(*schema.Obj); ok {
		return o.Get(key)
	}
	m, _ := v.(map[string]any)
	x, ok := m[key]
	return x, ok
}

// orderedRecord is a record in the order it came. One decoded into a Go map has lost that order and takes its keys'
// sorted order: callers decode a pack with schema.DecodeJSON.
func orderedRecord(v any) *schema.Obj {
	if o, ok := v.(*schema.Obj); ok {
		return o
	}
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	o, err := schema.DecodeJSON(raw)
	if err != nil {
		panic(err)
	}
	return o.(*schema.Obj)
}

// Pack is a parsed pack. Normalized is the same document as decoded JSON, defaults applied.
type Pack struct {
	Normalized map[string]any `json:"-"`

	ID      string `json:"id"`
	Version string `json:"version"`
	Ruleset struct {
		ID    string `json:"id"`
		Range string `json:"range"`
	} `json:"ruleset"`
	License     string  `json:"license"`
	Attribution *string `json:"attribution"`
	Sources     []struct {
		ID string `json:"id"`
	} `json:"sources"`
	Entries []PackEntry `json:"entries"`
}

func (p *Pack) semanticProblems(r *Ruleset) (found, warnings problems) {
	// ponytail: the ruleset's version is not matched against ruleset.range (the range is only shape-checked, like the
	// manifest's core); matching comes with the importer's version pinning.
	if p.Ruleset.ID != r.ID {
		found.add("ruleset.id", `written for "%s", not "%s"`, p.Ruleset.ID, r.ID)
	}
	if slices.Contains([]string{"srd", "cc-by", "orc"}, p.License) && p.Attribution == nil {
		found.add("attribution", "a %s pack must name its attribution", p.License)
	}
	// Rule entries need a printed page, unless nothing printed backs them (the pack is the author's own).
	exempt := p.License == "original"
	if !exempt {
		exempt = true
		for _, s := range r.Sources {
			exempt = exempt && s.License == "homebrew"
		}
	}
	seen := map[string]bool{}
	withEffects := map[string][]int{} // entry type → indices of its entries that have effects
	kindOf := map[string]string{}     // entity type → the kind of record it holds
	recordIDs := map[string]bool{}    // entity type and record id, seen
	if r.Build != nil {
		for _, kind := range LedgerKinds {
			kindOf[r.Build.Kinds[kind]] = kind
		}
	}
	for i, entry := range p.Entries {
		at := fmt.Sprintf("entries[%d]", i)
		if seen[entry.Key] {
			found.add(at+".key", `duplicate key "%s"`, entry.Key)
		}
		seen[entry.Key] = true
		if !exempt && entry.Cite == nil {
			found.add(at+".cite", "an entry needs a cite")
		}
		if size := len(CanonicalJSON(entry.Body)); size > MaxEntryBodyBytes {
			found.add(at+".body", "%d bytes, over the cap of %d", size, MaxEntryBodyBytes)
		}
		entity := r.entity(entry.Type)
		if entity == nil {
			found.add(at+".type", `unknown entity "%s"`, entry.Type)
			continue
		}
		if len(entry.Effects) > 0 {
			withEffects[entry.Type] = append(withEffects[entry.Type], i)
		}
		for _, field := range sortedKeys(entry.Body) {
			path := at + ".body." + field
			def, ok := entity.Fields[field]
			if !ok {
				found.add(path, `%s has no field "%s"`, entity.ID, field)
				continue
			}
			value := entry.Body[field]
			if why := CheckFieldValue(&def, value); why != "" {
				found.add(path, "%s", why)
			} else if text, isText := value.(string); isText && p.License == "private" && def.Type == "text" {
				if size := unitLength(text); size > privateTextWarnChars {
					warnings.add(path, "%d characters: summarise in your own words, with the page, instead of copying the book", size)
				}
			}
		}
		record := found.record(r, entry, i, kindOf[entry.Type])
		if record == nil {
			continue
		}
		p.Entries[i].Record = record
		p.Normalized["entries"].([]any)[i].(map[string]any)["record"] = record
		// A record's id is unique within its kind, not across the pack, so a reader finds it by type and id, never by key.
		id, _ := record.Get("id")
		key := entry.Type + "\x00" + fmt.Sprint(id)
		if recordIDs[key] {
			found.add(at+".record.id", `another "%s" in this pack already has the id "%v"`, entry.Type, id)
		}
		recordIDs[key] = true
	}
	// Effects hold for every actor type that picks the entry's type in a choose step.
	for _, typ := range sortedKeys(withEffects) {
		list := withEffects[typ]
		var pool []*EntityType
		for k := range r.Entities {
			e := &r.Entities[k]
			if slices.ContainsFunc(r.Creation, func(s CreationStep) bool { return s.Kind == "choose" && s.Pick == typ && s.Actor == e.ID }) {
				pool = append(pool, e)
			}
		}
		if len(pool) == 0 {
			for _, i := range list {
				found.add(fmt.Sprintf("entries[%d].effects", i), `nothing chooses a "%s", so these could never apply`, typ)
			}
			continue
		}
		entries := make([]ActiveEntry, len(list))
		for k, i := range list {
			e := p.Entries[i]
			entries[k] = ActiveEntry{Type: e.Type, Key: e.Key, Name: e.Name, Effects: e.Effects}
		}
		found = append(found, entryEffectProblems(r, entries, pool, func(k, j int) string {
			return fmt.Sprintf("entries[%d].effects[%d]", list[k], j)
		})...)
	}
	sourceIDs := map[string]bool{}
	for i, s := range p.Sources {
		if sourceIDs[s.ID] {
			found.add(fmt.Sprintf("sources[%d].id", i), `duplicate id "%s"`, s.ID)
		}
		sourceIDs[s.ID] = true
	}
	return found, warnings
}

// ValidatePack takes a pack as decoded JSON: size cap, schema, then what a schema can't say. A long text in a private
// pack is a warning, never a refusal. Every problem carries its path, such as entries[3].cite.
//
// Decode the input with schema.DecodeJSON: the ledger builder reads its records' keys in order (house decision #62),
// and a record decoded into a Go map has lost it. In Normalized and Entries each record is the *schema.Obj its schema
// answers; everything else is plain maps.
func ValidatePack(input any, r *Ruleset) (pack *Pack, found, warnings []Problem) {
	if size := len(CanonicalJSON(input)); size > MaxPackBytes {
		return nil, []Problem{{"(root)", fmt.Sprintf("%d bytes, over the cap of %d", size, MaxPackBytes)}}, nil
	}
	parsed, issues := schema.Parse(packSchema, input)
	if len(issues) > 0 {
		found = make([]Problem, len(issues))
		for i, issue := range issues {
			found[i] = Problem{formatPath(issue.Path), issue.Message}
		}
		return nil, found, nil
	}
	plain := schema.Plain(parsed).(map[string]any)
	raw, err := json.Marshal(plain)
	if err != nil {
		panic(err)
	}
	p := &Pack{Normalized: plain}
	if err := json.Unmarshal(raw, p); err != nil {
		panic(err)
	}
	entries, _ := jsonField(parsed, "entries")
	for i, entry := range entries.([]any) {
		if record, ok := jsonField(entry, "record"); ok {
			p.Entries[i].rawRecord = orderedRecord(record)
		}
	}
	semantic, warned := p.semanticProblems(r)
	if len(semantic) > 0 {
		return nil, semantic, warned
	}
	return p, nil, warned
}

// PackDiff says what an import changes. Each list is sorted.
type PackDiff struct {
	Added   []string `json:"added"`
	Changed []string `json:"changed"`
	Removed []string `json:"removed"`
}

// DiffHashes compares two key to content hash maps; the importer holds these in pack_entry without loading bodies.
func DiffHashes(prev, next map[string]string) PackDiff {
	out := PackDiff{[]string{}, []string{}, []string{}}
	for _, key := range sortedKeys(next) {
		was, existed := prev[key]
		if !existed {
			out.Added = append(out.Added, key)
		} else if was != next[key] {
			out.Changed = append(out.Changed, key)
		}
	}
	for _, key := range sortedKeys(prev) {
		if _, kept := next[key]; !kept {
			out.Removed = append(out.Removed, key)
		}
	}
	return out
}
