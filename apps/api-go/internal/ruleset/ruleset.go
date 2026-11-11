// Package ruleset holds imported rulesets and the rule actions a table runs on them: the context an op runs in, the
// ops' pipeline, and the checks an import goes through.
package ruleset

import "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"

// LoadCompiled is the compiled ruleset a campaign has pinned, or nil before one is (compiled.Load, kept under its first
// name for the callers that read it here).
var LoadCompiled = compiled.Load
