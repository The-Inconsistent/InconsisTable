# Each game is a Module that owns its realm, rules, content and look

Status: proposed

## Context

The product owner asked on 2026-11-27 for a separate module for each game (D&D, Warhammer Fantasy, Warhammer 40k,
Magic: The Gathering and others). Each module has its own realm, rules, setup, fights, character building, style and
theme, and is managed on its own. A user picks a module before setting up a room, and the room loads that module.

What exists today is a set of loose parts:

- A **ruleset** manifest (`packages/rules-engine/src/manifest.ts`, Go twin in `internal/engine`) declares terms,
  entities and fields, derived values, resources, conditions, tests, initiative, phases, scoring, health, creation
  steps, options, decisions and layout. NEW ROOM picks one and the room pins `ruleset@version` (design §3.3, §4.5).
- **Packs** carry content for a ruleset and are attached to a room one by one.
- The **World** (design §4.7) is not built. The theme is a device-wide cookie, marked in `apps/web/app/layout.tsx` as a
  ponytail to replace with the room's World.

Nothing ties these together. A ruleset, its packs and its look have separate owners, separate versions and separate
pins, so no one can manage "the D&D module" as one thing, and a room can hold a pack version that its ruleset version
was never tested with.

Auspex built one game as code in `packages/shared` (`build.ts`, `wargear.ts`, `threat.ts`, `requisition.ts`, `dn.ts`).
Design §2.2 lists the work it takes to turn that code back into data. This repo also ships no game content (ADR 0001),
and D&D beyond the SRD, Warhammer and Magic are published works.

## Decision

**A Module is the unit a user picks, owns and manages.** It is data that users import, not code in this repo.

A Module owns:

| Part | Holds | Today |
| --- | --- | --- |
| Rules | one ruleset line, its versions and its house decisions | ruleset, now owned by the Module |
| Content | its packs | packs, now owned by the Module |
| Realm | lore shared by every room of the Module (places, factions, NPCs), and handout styles | new |
| Theme | a theme as tokens: colours, a display and a text face from the platform's font list, a texture from the platform's set | new; replaces the device cookie |
| Words | `terms`, the Module's names for party, foe, health and the rest | ruleset `terms`, moved up |

- **One version pins everything.** A `module_version` is immutable and names one `ruleset_version`, the
  `pack_version`s it was released with, and its realm, theme and words. A campaign pins one `module_version`. Upgrading a room
  is one step: the GM picks a newer Module version, sees the dry-run diff of the ruleset migrations (design §4.5), and
  applies it. The room never mixes parts from two releases.
- **Each Module is managed on its own.** It has an owner and maintainers, its own release line, its own house
  decisions, its own visibility and license, and its own takedown. Releasing, deprecating or hiding one Module touches
  no other. The admin console lists and moderates Modules, not loose rulesets.
- **NEW ROOM starts with the Module.** Step 1 picks a Module the user may use (public, or their own, or granted),
  step 2 its version, and the room loads its rules, content, realm, theme and words. A GM may still attach an extra pack
  made for the same ruleset, and write house rules, as overlays on the pinned release.
- **The gallery is how a GM picks a game.** NEW ROOM opens on a gallery of cards, each drawn in its Module's theme with
  its title, kind (RPG or board game), player count and license badge. A card reads a small preview (those fields and
  the theme tokens), never the whole manifest. Tapping a card and then Create room pins the latest `module_version`
  directly; nothing is copied into the GM's library, and no JSON is involved. Older versions sit behind "Other
  versions". "My modules" sits beside the gallery with the GM's own and private Modules.
- **The public gallery is open-license only.** A Module appears there only when every part is licensed
  `srd | orc | cc-by | original` and an admin approved it (the `pack:approve` flow of design §4.6, applied to the
  whole Module). Maintainers (the team, working in a content repo such as `inconsistable-content`, or community users)
  import Modules through the library's maintainer tools. JSON import stays there, for authors only.
- **A published game gets a Skeleton, not a Module.** For a game whose rules are not openly licensed, the gallery may
  offer a Skeleton: an `original` Module version with a theme, generic words, an empty realm structure and a list of
  rule slots (entity types, fields, resources, tests, initiative, conditions) that name what to fill but hold no
  values. A Skeleton never names the game, its publisher, its factions or its trademarks, and its theme never copies a
  publisher's trade dress; it is a genre ("gothic far-future war", "grim low fantasy", "card duel"). Picking one forks
  it into a `private` Module owned by the GM (`extends`, design §4.5), and a guided form walks the GM through each slot
  with their own book: a number or a choice, and a page cite. Each filled slot becomes a manifest entry, so the result
  is an ordinary private Module and passes the same validator. A Skeleton has no `ruleset_version`; its slots are one
  JSONB document in its `module_version`. A room can pin only a playable version, never a Skeleton.
- **The theme is data the platform renders.** Every seat of a room shows the Module's theme. Token values are
  validated (hex colours, a font id from the list, a texture id from the set). A Module never ships CSS, fonts,
  images or script, so imported data cannot inject styles or carry book art (principle 2).
- **Mechanics stay shared primitives.** The api and the web never branch on a Module id. A mechanic no primitive
  expresses becomes a new primitive, written in TypeScript and Go together and held equal by `vectors/*.ts`, and every
  Module can use it. The first two are `dice.rollUnder` (Warhammer Fantasy, Call of Cthulhu) and
  `initiative.alternatingSides` with Seize (Wrath & Glory, the parity target in design §2.2). Screens render from the
  manifest's `entities`, `creation` and `layout`.
- **One file moves a Module.** Export writes `{ module, ruleset, packs[], realm, theme }`. Import runs the existing
  ruleset and pack validation in one transaction and lands whole or not at all. Every part keeps its gates: cites,
  quotas, licenses, and the `private` rule (principle 4). A Module with a `private` pack is `private` as a whole.
- **The QuickJS hook tier (design §4.1) stays unbuilt** until a real Module needs a mechanic that a declarative
  primitive cannot express.

## Considered options

- **A code package per game** (`modules/dnd`, `modules/warhammer`, each with its own TypeScript and Go, screens and
  CSS). Each game could do anything, and would look most like "a separate module". It was rejected for four reasons:
  the repo would ship game mechanics and terms for published games (ADR 0001), every game needs two implementations
  held equal (ADR 0008), new games wait on a platform release instead of a user import, and it repeats the Auspex
  build that design §2.2 is undoing. What it buys (a mechanic no manifest expresses) the primitive and hook tiers
  give without a fork per game.
- **Loose rulesets, packs and Worlds, plus a one-time install file:** the smallest change, but no one owns "the
  game", versions drift apart inside a room, and there is nothing to manage on its own.
- **A Module that ships its own CSS or assets:** the freest look, but a style injection surface on every seat, and a
  `private` Module could carry book art.
- **Public mechanics-only Modules for published games** (numbers and page cites, no book text): the closest to one
  click for Warhammer or Magic, but whether that is lawful is a legal question this ADR cannot answer, and some
  publishers enforce their rights hard. Not done unless legal advice says it is safe; the Skeleton covers the need
  until then.
- **Rule slots in the manifest itself** (entries marked "to fill" that the validator accepts): changes the manifest
  schema in both engines for a state only the builder needs. Keeping the slots in their own document leaves the
  manifest and its validator as they are.
- **A micro frontend or a code package per game:** see the first option. Both put per-game code in the platform, and a
  micro frontend covers only the browser while the Go api still decides. If outside developers ever need their own
  game UI, the fit is a sandboxed iframe plugin with a narrow `postMessage` API, outside this monorepo.

## Consequences

- New tables, written as the next migration: `module` (owner, slug, title, license, visibility, hidden and disabled
  stamps), `module_maintainer`, `module_version` (the realm, theme and words as one JSONB document, read and written
  whole), and `module_version_pack`. `ruleset` and `pack` gain `module_id`. `campaign` pins `module_version_id` in
  place of `ruleset_version_id`. Existing rulesets become one Module each in that migration.
- Grants move up: `pack_grant` becomes a Module grant, and the `private` rule applies to the Module.
- NEW ROOM, the library and the admin console are reworked around Modules. The ponytail in `apps/web/app/layout.tsx`
  goes: the room's Module picks the theme.
- New surfaces: a gallery endpoint that lists approved public Modules as previews (gated like `/api/frameworks` in
  design §4.6), the admin approval queue for Modules, and the guided slot form. The slot form is the first form-based
  authoring tool; a full form builder for maintainers, retiring JSON for authors too, is a later step.
- `module_version` gains a kind (`playable` or `skeleton`) and, for a Skeleton, its slots document. A database check
  keeps `ruleset_version_id` set exactly when the kind is `playable`.
- Each Module that needs a missing mechanic waits on a primitive PR, with vectors and a house decision where the book
  leaves the rule open.
- Rules depth stays where ADR 0007 put it. A Magic or 40k tabletop Module tracks life, counters, phases and victory
  points; decks, hands, moves and their legality stay on the table.
- Licensing does not change. A Module for a published game holds `private` packs with page cites, imported by the GM
  who owns the books. Only `srd | orc | cc-by | original` Modules can become public, after approval.
- `CONTEXT.md` gains **Module**, **Realm**, **Gallery** and **Skeleton**. World splits into Realm and Theme inside a
  Module.
