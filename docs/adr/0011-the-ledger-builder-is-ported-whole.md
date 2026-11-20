# The ledger builder is ported whole from Auspex, as one primitive

Status: proposed (2026-11-20). The product owner chose the port (`docs/p3-plan.md`, "Đã chốt" item 9); the staging
below, and where the builder runs first, await their word.

## Context

Wrath & Glory characters are bought with XP: an Archetype, ratings on cumulative price tables, Talents, powers,
Ascension packages, with requirements and grants on every catalogue record. Auspex resolves all of it in one pure
function, `resolveBuild` (`packages/shared/src/build.ts`, 2,498 lines, 68 tests, 11 pregenerated characters that must
rebuild to their printed sheets and ledgers). It is the finished, played reference.

ADR 0010 left room for this as a primitive ("a system the steps cannot express gets a primitive") but pictured generic
blocks: a cost, requirements and grants on any pack entry. The product owner was offered that route and chose to port
the Auspex builder whole instead: parity with a played system first, generality later.

What the inventory of 2026-11-20 found, and what makes a faithful port possible:

- The builder is pure: no I/O, clock or randomness.
- What `resolveBuild` needs is about 3,060 lines: 870 of schemas, 2,000 of rule functions, 90 of constants.
- It tests no record id as a literal. What is specific to the game in the code is a short list: the price tables and
  limits, the vocabularies (Attributes, Skills, Trait bonuses, sub-faction types, Talent categories), four keyword
  conventions, and about 45 page cites.
- Auspex keeps the books' wording beside the structure, and passes some of it to the sheet.

## Decision

**1. One primitive, `build.ledger`, holds the flow and nothing from a book.** The code is copied from Auspex, not
rewritten: same steps, same order, same paths for choices and GM approvals, so a build saved in Auspex resolves the
same here. Every number, every name and every cite comes from the imported ruleset as the primitive's parameters:
price tables, starting XP, Rank, the wealth and language prices, the Advanced Creation limits, the vocabularies, the
keyword conventions, the sources and which are official. A second game with the same kind of ledger could pick the
primitive with its own parameters; no claim is made that one will.

**2. The catalogue is pack data in Auspex's shape, without the books' wording.** A pack entry gains a document beside
its flat `body` and its `effects` (house decision #61): the catalogue record the primitive reads (requirements, grants,
ratings, keywords, wargear). Fields that hold printed text are dropped; a record, and a rule inside it, may carry a
short optional `summary` in the importer's own words (principle 2). A GM-judged requirement or a story grant keeps a
stable id, so the path of a GM's approval does not depend on its wording. Two packs carry the data: creation and
wargear ("Đã chốt" items 7 and 8).

**3. What is stored.** The build (the player's choices) and the sheet it resolves to are documents read and written
whole, so JSONB (CLAUDE.md, data rules). The numbers the rest of the platform reads (Attributes, Skill ratings,
armour, Trait bonuses, Species, Archetype, keywords) are also written as the actor's typed field rows, so derived
values, Tests and health states work as they do for a character copied in by hand. The ledger, the pending choices and
the problems are never stored: they are resolved again from the build.

**4. Proof of the port stays where the content is.** InconsisTable holds no game content (ADR 0001), so its tests of
the primitive use an invented catalogue with invented prices. The 11 pregens, "every Archetype resolves" and the rule
tests run in the Auspex repo against this engine, through the loader the ruleset's parity tests already use. A slice of
the port is done when those pass.

**5. Stages.**

1. The primitive in TypeScript (`packages/rules-engine/src/build/`), with its parameters and the invented-content
   tests. Nothing uses it yet.
2. In the Auspex repo: the ruleset's parameters, the two pack generators, and the parity tests.
3. The platform around it: the entry document (schema, storage, import, export, the served rules), the stored build and
   sheet, the action that saves a build and writes the field rows, and the seat view of the sheet.
4. The builder screens, then buying in play and Ascension.

## Open: where the builder runs first

The api is Go, and principle 6 has the server decide. A Go twin of the primitive, held equal by vectors, roughly doubles
stage 1 and belongs to stage 3. Two ways:

- **Both engines together:** the server resolves every build. The two-engine rule is kept from the first merge.
- **On the device first:** the browser resolves the build and shows the ledger; the server stores the build and checks
  only each field's range, as the free-input creation does today. The Go twin follows. Until it does, a submitted
  sheet is not proven by its ledger, which is the trust the by-hand creation already gives. Marked `ponytail:` with the
  twin as the upgrade.

Stages 1 and 2 are the same either way.

## Considered options

- **Generic blocks on every entry** (a cost, requirements as expressions, grants from a short list): reusable by any
  game and in line with ADR 0010. Not chosen by the product owner: it rebuilds a finished, tested system before the
  table can use it.
- **Generic blocks, pregens first:** the same, cut to what the 11 pregens need. Not chosen for the same reason.
- **A Wrath & Glory package in this repo** with the numbers and names in code: the shortest port. Refused: it puts book
  numbers and vocabulary in the platform (ADR 0001, principle 1). The parameters of decision 1 cost one indirection.

## Consequences

- ADR 0010's table of who brings what gains a row in practice: for a ledger game, the builder's flow is the platform's.
- Problem texts are English sentences with the game's terms, as in Auspex. Until they become codes worded by the
  ruleset, the builder is not translated. Marked `ponytail:`.
- Some grants change no number (followers, per-session awards, bonus dice): they stay lines on the build's effects
  list, as in Auspex, with a cite and no wording unless a summary is written.
- "Pack entries carry effects" (house decision #61) is not used by this builder, which computes its own bonuses. It
  remains the block for rulesets built from creation steps.
- The Go twin, when written, must reproduce orderings the TypeScript relies on (insertion order of maps and sets,
  stable sorts, key order of serialised requirements); the vectors must cover them.
