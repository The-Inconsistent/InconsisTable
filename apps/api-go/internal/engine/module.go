package engine

import (
	"fmt"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// A game module (docs/adr/0010-game-modules.md, decision 4; house decisions #122 to #125): the list that makes one game
// of an owner's parts. The twin of packages/rules-engine/src/module.ts; the vectors hold the two equal.

const (
	// MaxModuleBytes is MAX_MODULE_BYTES: the largest module file, carried documents included (one pack's cap).
	MaxModuleBytes = MaxPackBytes
	// MaxModulePacks is MAX_MODULE_PACKS: the most packs one module names, and carries.
	MaxModulePacks = 20
)

var modulePart = schema.Object(
	schema.Req("slug", rulesetID),
	schema.Req("version", semVer),
	schema.Opt("hash", schema.String().Regex(`^[0-9a-f]{64}$`, "use the sha-256 hash in lower-case hex")),
).Strict()

var moduleSchema = schema.Object(
	schema.Req("id", rulesetID),
	schema.Req("version", semVer),
	schema.Req("core", semVerRange),
	schema.Req("name", schema.String().Min(1).Max(80)),
	schema.Req("ruleset", modulePart),
	schema.Req("packs", schema.Array(modulePart).Max(MaxModulePacks)),
	schema.Opt("world", modulePart),
	schema.Opt("documents", schema.Object(
		schema.Opt("ruleset", schema.Unknown()),
		schema.Opt("packs", schema.Array(schema.Unknown()).Max(MaxModulePacks)),
		schema.Opt("world", schema.Unknown()),
	).Strict()),
).Strict()

// ValidateModule is validateModule: the size cap (as serialised), the schema, then no pack named twice. The module
// comes back as plain maps, its carried documents too; an importer that needs a pack's key order reads it from input.
func ValidateModule(input any) (map[string]any, []Problem) {
	if size := len(CanonicalJSON(input)); size > MaxModuleBytes {
		return nil, []Problem{{"(root)", fmt.Sprintf("%d bytes, over the cap of %d", size, MaxModuleBytes)}}
	}
	parsed, issues := schema.Parse(moduleSchema, input)
	if len(issues) > 0 {
		found := make([]Problem, len(issues))
		for i, issue := range issues {
			found[i] = Problem{formatPath(issue.Path), issue.Message}
		}
		return nil, found
	}
	module := schema.Plain(parsed).(map[string]any)
	var found []Problem
	seen := map[string]bool{}
	packs, _ := module["packs"].([]any)
	for i, p := range packs {
		slug, _ := p.(map[string]any)["slug"].(string)
		if seen[slug] {
			found = append(found, Problem{fmt.Sprintf("packs[%d].slug", i), fmt.Sprintf("%q is named twice", slug)})
		}
		seen[slug] = true
	}
	if len(found) > 0 {
		return nil, found
	}
	return module, nil
}

// ModuleHash is moduleHash: the hash a module version is stored under, of the canonical document without what it
// carries.
func ModuleHash(module map[string]any) string {
	named := make(map[string]any, len(module))
	for k, v := range module {
		if k != "documents" {
			named[k] = v
		}
	}
	return Sha256Hex(CanonicalJSON(named))
}
