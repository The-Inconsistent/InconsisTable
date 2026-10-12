import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ConditionDuration, DeltaKind, DeltaTarget, DeltaValue, type FieldDef } from "@inconsistable/rules-engine";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";

// The one place an actor's value rows are written (docs/design.md §5.4). A delta goes in, the row before and after
// comes out (Postgres 18 RETURNING OLD/NEW), which is what the session log and undo are built on. Nothing else
// updates actor_resource, actor_field or actor_condition.

/** One condition an actor has, as its `actor_condition` row holds it (the row's own id is the delta target). */
export const ConditionRow = z.object({
  conditionId: z.string(),
  stacks: z.int(),
  source: z.string(),
  expiresOn: ConditionDuration,
  expiresAfter: z.int().nullable(),
});
export type ConditionRow = z.infer<typeof ConditionRow>;

/** A condition row is a value like any other: written, logged and undone through the same delta. */
export type ConditionTarget = Extract<DeltaTarget, { condition: string }>;

export const LogTarget = DeltaTarget;
export type LogTarget = DeltaTarget;

export const LogValue = z.union([DeltaValue, ConditionRow]);
export type LogValue = z.infer<typeof LogValue>;

export interface DeltaInput {
  target: LogTarget;
  kind: DeltaKind;
  value: LogValue;
}

/** What a write did: the value before (null when the row was new) and after (null when it was removed). */
export interface Written {
  target: LogTarget;
  kind: DeltaKind;
  before: LogValue;
  after: LogValue;
}

export interface Bounds {
  min: number;
  /** null: no ceiling. */
  max: number | null;
}

export type FieldType = FieldDef["type"];

type Row = Record<string, unknown>;
const first = (rows: Row[]) => rows[0];
const toInt = (v: unknown) => (typeof v === "number" ? v : null);
const toText = (v: unknown) => (typeof v === "string" ? v : null);

/** A stored field row as the value a ruleset reads. */
export function decodeField({ type, row }: { type: FieldType; row: { int: unknown; text: unknown; ref: unknown } }) {
  const [int, text, ref] = [toInt(row.int), toText(row.text), toText(row.ref)];
  if (int === null && text === null && ref === null) return null;
  if (type === "bool") return int === null ? null : int === 1;
  if (type === "int") return int;
  if (type === "ref") return ref;
  return text; // text, enum; a list is decoded from its rows
}

// A resource row. `add` adds to the stored value, `set` replaces it; both clamp to the bounds in the same statement,
// so two taps at once never overwrite each other. A max below the min collapses to the min.
async function writeResource(
  tx: Tx,
  {
    campaignId,
    delta,
    target,
    bounds,
  }: { campaignId: string; delta: DeltaInput; target: ActorResource; bounds: Bounds },
): Promise<Written> {
  const { value } = delta;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(`${target.resource} takes a whole number`);
  const min = bounds.min;
  const clamp = (v: SQL): SQL => {
    const floor = sql`GREATEST(${v}, ${min}::int)`;
    return bounds.max === null ? floor : sql`LEAST(${floor}, ${Math.max(min, bounds.max)}::int)`;
  };
  const v = sql`${value}::int`;
  // The first value of a row that does not exist yet is the delta itself (from nothing).
  const update = clamp(delta.kind === "add" ? sql`r.value + ${v}` : v);
  const res = await tx.execute(sql`
    INSERT INTO actor_resource AS r (actor_id, resource_id, value)
    SELECT a.id, ${target.resource}::text, ${clamp(v)} FROM actor a
    WHERE a.id = ${target.actorId}::uuid AND a.campaign_id = ${campaignId}::uuid
    ON CONFLICT (actor_id, resource_id) DO UPDATE SET value = ${update}
    RETURNING OLD.value AS before, NEW.value AS after`);
  const row = first(res.rows);
  if (!row) fail("Character not found");
  return { target, kind: delta.kind, before: toInt(row.before), after: toInt(row.after) };
}

// A field. Scalars upsert one row (ordinal 0); a list replaces its rows. A null value unsets the field.
async function writeField(
  tx: Tx,
  { campaignId, delta, target, type }: { campaignId: string; delta: DeltaInput; target: ActorField; type: FieldType },
): Promise<Written> {
  if (delta.kind !== "set") fail(`${target.field} is set, not adjusted`);
  const { actorId, field } = target;
  const { value } = delta;
  const mine = sql`a.id = ${actorId}::uuid AND a.campaign_id = ${campaignId}::uuid`;
  // An empty list is an unset field: it has no rows.
  const next = Array.isArray(value) && value.length === 0 ? null : value;
  if (type === "list" && next !== null && !Array.isArray(next)) fail(`${field} takes a list`);

  const removed = async () => {
    const res = await tx.execute(sql`
      DELETE FROM actor_field f USING actor a
      WHERE f.actor_id = a.id AND ${mine} AND f.field_id = ${field}::text
      RETURNING f.ordinal, f.int_value AS v_int, f.text_value AS v_text, f.ref_key AS v_ref`);
    return res.rows.sort((x, y) => Number(x.ordinal) - Number(y.ordinal));
  };
  const decode = (rows: Row[]) =>
    type === "list"
      ? rows.length === 0
        ? null
        : rows.map((r) => toText(r.v_text) ?? "")
      : rows[0]
        ? decodeField({ type, row: { int: rows[0].v_int, text: rows[0].v_text, ref: rows[0].v_ref } })
        : null;

  if (next === null || type === "list") {
    const before = decode(await removed());
    if (next === null || !Array.isArray(next)) return { target, kind: "set", before, after: null };
    const res = await tx.execute(sql`
      INSERT INTO actor_field (actor_id, field_id, ordinal, text_value)
      SELECT a.id, ${field}::text, (u.ord - 1)::int, u.v FROM actor a,
        jsonb_array_elements_text(${JSON.stringify(next)}::jsonb) WITH ORDINALITY AS u(v, ord)
      WHERE ${mine}`);
    if (res.rowCount !== next.length) fail("Character not found");
    return { target, kind: "set", before, after: next };
  }

  const int = typeof next === "boolean" ? Number(next) : typeof next === "number" ? next : null;
  const text = typeof next === "string" && type !== "ref" ? next : null;
  const ref = typeof next === "string" && type === "ref" ? next : null;
  if (int === null && text === null && ref === null) fail(`${field} doesn't take that value`);
  const res = await tx.execute(sql`
    INSERT INTO actor_field AS f (actor_id, field_id, ordinal, int_value, text_value, ref_key)
    SELECT a.id, ${field}::text, 0, ${int}::int, ${text}::text, ${ref}::text FROM actor a WHERE ${mine}
    ON CONFLICT (actor_id, field_id, ordinal) DO UPDATE
      SET int_value = EXCLUDED.int_value, text_value = EXCLUDED.text_value, ref_key = EXCLUDED.ref_key
    RETURNING OLD.int_value AS b_int, OLD.text_value AS b_text, OLD.ref_key AS b_ref,
              NEW.int_value AS a_int, NEW.text_value AS a_text, NEW.ref_key AS a_ref`);
  const row = first(res.rows);
  if (!row) fail("Character not found");
  return {
    target,
    kind: "set",
    before: decodeField({ type, row: { int: row.b_int, text: row.b_text, ref: row.b_ref } }),
    after: decodeField({ type, row: { int: row.a_int, text: row.a_text, ref: row.a_ref } }),
  };
}

// A returned row (OLD is null on an insert, NEW on a delete) as the value the log keeps.
const conditionOf = (row: Row | undefined, prefix: string): ConditionRow | null => {
  const stacks = row?.[`${prefix}stacks`];
  if (!row || typeof stacks !== "number") return null;
  return ConditionRow.parse({
    conditionId: row[`${prefix}condition_id`],
    stacks,
    source: row[`${prefix}source`],
    expiresOn: row[`${prefix}expires_on`],
    expiresAfter: row[`${prefix}expires_after`],
  });
};

const CONDITION_OLD_NEW = sql.raw(`RETURNING OLD.condition_id AS b_condition_id, OLD.stacks AS b_stacks,
  OLD.source AS b_source, OLD.expires_on AS b_expires_on, OLD.expires_after AS b_expires_after,
  NEW.condition_id AS a_condition_id, NEW.stacks AS a_stacks, NEW.source AS a_source,
  NEW.expires_on AS a_expires_on, NEW.expires_after AS a_expires_after`);

// A condition row, named by its own id. `add` counts its `expiresAfter` (an uncounted row reads as 1, house decision
// #14); `set` with a row writes it whole (a new row, or putting a removed one back); `set` with null removes it.
async function writeCondition(
  tx: Tx,
  { campaignId, delta, target }: { campaignId: string; delta: DeltaInput; target: ConditionTarget },
): Promise<Written> {
  const { actorId, condition } = target;
  if (!z.uuid().safeParse(condition).success) fail("That isn't a condition on this character");
  const mine = sql`a.id = ${actorId}::uuid AND a.campaign_id = ${campaignId}::uuid`;
  const rowId = sql`${condition}::uuid`;

  if (delta.kind === "add") {
    if (typeof delta.value !== "number" || !Number.isSafeInteger(delta.value)) fail("A count takes a whole number");
    const res = await tx.execute(sql`
      UPDATE actor_condition AS c SET expires_after = COALESCE(c.expires_after, 1) + ${delta.value}::int
      FROM actor a WHERE c.id = ${rowId} AND c.actor_id = a.id AND ${mine} ${CONDITION_OLD_NEW}`);
    const out = first(res.rows);
    if (!out) fail("That condition is gone");
    return { target, kind: "add", before: conditionOf(out, "b_"), after: conditionOf(out, "a_") };
  }

  if (delta.value === null) {
    const res = await tx.execute(sql`
      DELETE FROM actor_condition AS c USING actor a WHERE c.id = ${rowId} AND c.actor_id = a.id AND ${mine}
      RETURNING c.condition_id AS b_condition_id, c.stacks AS b_stacks, c.source AS b_source,
                c.expires_on AS b_expires_on, c.expires_after AS b_expires_after`);
    return { target, kind: "set", before: conditionOf(first(res.rows), "b_"), after: null };
  }
  const row = ConditionRow.safeParse(delta.value);
  if (!row.success) fail("That isn't a condition");
  const c = row.data;
  const res = await tx.execute(sql`
    INSERT INTO actor_condition AS c (id, actor_id, condition_id, stacks, source, expires_on, expires_after)
    SELECT ${rowId}, a.id, ${c.conditionId}::text, ${c.stacks}::int, ${c.source}::text, ${c.expiresOn}::text,
           ${c.expiresAfter}::int
    FROM actor a WHERE ${mine}
    ON CONFLICT (id) DO UPDATE
      SET stacks = EXCLUDED.stacks, source = EXCLUDED.source, expires_on = EXCLUDED.expires_on,
          expires_after = EXCLUDED.expires_after
      WHERE c.actor_id = EXCLUDED.actor_id AND c.condition_id = EXCLUDED.condition_id
    ${CONDITION_OLD_NEW}`);
  const out = first(res.rows);
  if (!out) fail("Character not found");
  return { target, kind: "set", before: conditionOf(out, "b_"), after: conditionOf(out, "a_") };
}

type ActorResource = Extract<DeltaTarget, { resource: string }>;
type ActorField = Extract<DeltaTarget, { field: string }>;

/**
 * Writes one delta and says what it changed. Resources need the `bounds` the caller evaluated; fields need the
 * declared (or inferred) `type`. The row must belong to `campaignId`, so a client id never reaches another table.
 */
export async function writeDelta(
  tx: Tx,
  {
    campaignId,
    delta,
    bounds,
    fieldType,
  }: { campaignId: string; delta: DeltaInput; bounds?: Bounds; fieldType?: FieldType },
): Promise<Written> {
  const target = delta.target;
  if ("resource" in target) {
    if (!bounds) fail(`${target.resource} has no bounds`);
    return writeResource(tx, { campaignId, delta, target, bounds });
  }
  if ("field" in target) return writeField(tx, { campaignId, delta, target, type: fieldType ?? "text" });
  if ("condition" in target) return writeCondition(tx, { campaignId, delta, target });
  // ponytail: turn and Test values live in the encounter and test_call tables, which arrive with the combat tracker
  // and the Test call; until then an op that writes them is refused here, before anything else is changed.
  return fail("That needs an encounter, which arrives with the combat tracker");
}

/** The value a target holds now, for undo to compare with what a delta left behind. Resources are never compared. */
export async function readTarget(
  tx: Tx,
  { campaignId, target, fieldType }: { campaignId: string; target: LogTarget; fieldType?: FieldType },
): Promise<LogValue> {
  if ("condition" in target) {
    const res = await tx.execute(sql`
      SELECT c.condition_id AS b_condition_id, c.stacks AS b_stacks, c.source AS b_source,
             c.expires_on AS b_expires_on, c.expires_after AS b_expires_after
      FROM actor_condition c JOIN actor a ON a.id = c.actor_id
      WHERE a.id = ${target.actorId}::uuid AND a.campaign_id = ${campaignId}::uuid
        AND c.id = ${target.condition}::uuid`);
    return conditionOf(first(res.rows), "b_");
  }
  if (!("field" in target)) return fail("That value can't be read back");
  const type = fieldType ?? "text";
  const res = await tx.execute(sql`
    SELECT f.ordinal, f.int_value AS v_int, f.text_value AS v_text, f.ref_key AS v_ref
    FROM actor_field f JOIN actor a ON a.id = f.actor_id
    WHERE a.id = ${target.actorId}::uuid AND a.campaign_id = ${campaignId}::uuid AND f.field_id = ${target.field}::text
    ORDER BY f.ordinal`);
  if (type === "list") return res.rows.length === 0 ? null : res.rows.map((r) => toText(r.v_text) ?? "");
  const row = first(res.rows);
  return row ? decodeField({ type, row: { int: row.v_int, text: row.v_text, ref: row.v_ref } }) : null;
}

// Two stored values are the same when their JSON is, whatever order an object's keys came in.
const stable = (v: LogValue) =>
  JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : p > q ? 1 : 0)))
      : x,
  );
export const sameValue = (a: LogValue, b: LogValue) => stable(a) === stable(b);
