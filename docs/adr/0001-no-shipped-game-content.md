# InconsisTable ships no game content

Status: accepted

## Context

A table companion for RPGs and board games is tempting to ship with a ready ruleset and sample content. Almost all of
that content is copyrighted (CLAUDE.md principle 2), and a hosted platform that redistributes it becomes a distributor.

## Decision

The repo and the platform ship no rulesets, packs, book text, stat blocks, art or PDFs. Every ruleset and pack is
imported by its users (`/api/rulesets`, `/api/packs`, the `/library` UI), private by default (design §4.6). Tests and
fixtures use invented content ("Sample p.N"). Even SRD material is imported like any other pack.

## Considered options

- Bundle SRD/ORC/CC-BY content: permitted by those licenses, but it blurs the rule, needs attribution upkeep, and
  invites "just add one more book".
- A curated public catalog: needs moderation and takedown handling (`pack:approve`, deferred to P4).

## Consequences

- An empty install does nothing until someone imports a ruleset; the importer and its validator (cites required,
  except in homebrew) are core features, not tooling.
- Notice-and-takedown is an admin action on imported packs, not a content decision.
- Playtest content lives in a separate private repo and never enters this one.
