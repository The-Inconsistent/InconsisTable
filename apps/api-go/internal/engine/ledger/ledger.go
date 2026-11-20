// ponytail: problem and effect texts are English sentences with the game's terms, as in Auspex, upgrade: codes worded by the ruleset

// Package ledger is the Go twin of packages/rules-engine/src/build (docs/adr/0011): a character bought with XP from a
// catalogue of records, resolved by one pure function, Resolve. Nothing here is a ruleset's content: the numbers, names
// and cites are Params. Every file mirrors the TypeScript file of the same name, and apps/api-go/vectors/ledger.ts
// holds the two equal.
//
// The TypeScript reads JavaScript's orders (of object keys, Maps and Sets) and its numbers, so this package does too:
// input is decoded with schema.DecodeJSON into ordered trees and parsed by the schemas into the same trees, numbers are
// float64, and strings are cut in UTF-16 units.
package ledger
