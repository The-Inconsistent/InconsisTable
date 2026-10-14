# Actor values are typed rows, written through one `writeDelta`

Status: accepted

## Context

A character's fields, resources, conditions and choices change constantly and concurrently (damage, spending, rests),
and every change must be clamped, visible per seat, and undoable. A JSONB document per actor would force
read-modify-write cycles and make clamping, filtering and undo application code (CLAUDE.md principle 6, design §5.4).

## Decision

Values are typed rows keyed by `actor_id`: `actor_field`, `actor_resource`, `actor_condition`, `actor_choice`. Every
write goes through a single `writeDelta`. Resources use one `INSERT ... ON CONFLICT ... LEAST/GREATEST ... RETURNING
OLD/NEW` so the server clamps; fields and turns use `UPDATE ... RETURNING OLD/NEW`. Each delta is logged with before
and after in `session_event`, which is what undo reads. JSONB stays for whole documents only (manifests, pack bodies,
the event log, drafts). A spawned creature's values are copied as rows at spawn; pack versions are immutable, so the
rows are the snapshot.

## Considered options

- One JSONB `stats` document per actor: flexible, but no atomic delta, no per-column constraints or filters, and undo
  would need whole-document diffs.
- Event sourcing with projected state: stronger history, far more machinery than a table companion needs.

## Consequences

- No hand-written `UPDATE` on value tables outside `writeDelta`.
- Undo of an `add` delta applies `after - before` and does not clobber later deltas; a `set` undoes only if the current
  value still equals `after`.
- Adding a ruleset field needs no migration, since rows are keyed by the field id.
