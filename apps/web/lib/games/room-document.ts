import {
  ROOM_FORMAT,
  ROOM_VERSION,
  RoomDocument,
  type CodexKind,
  type RoomDocumentInput,
} from "@inconsistable/core-schema";
import type { CampaignField, ChecklistStep, Ruleset } from "@inconsistable/rules-engine";

import { declaredFields, type DeclaredField, type EntryFieldValue } from "@/lib/entry-fields/entry-fields";

/** The steps of the campaign wizard (house decision #142), in order; a game shows only the ones it asks. */
export const WIZARD_STEPS = ["game", "campaign", "premise", "table", "name"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** The field types the wizard asks before the room exists: none of them reads a pack, a table or another entry. */
const ASKED: ReadonlySet<string> = new Set(["text", "int", "enum", "bool", "tags"]);

/** The premise a ruleset declares: the kind its entry is, the checklist step that asks for it, the fields asked. */
export type Premise = { kind: CodexKind; step: ChecklistStep; fields: DeclaredField[] };

/**
 * The premise of a game (house decision #142), found by what its ruleset declares without naming any game: the first
 * checklist step that asks for an entry of a kind with a field written (no value it must equal, no prepared lines), where
 * that field is one the party reads. The wizard asks that kind's fields that need no room yet; a `tags` field offers
 * only its fixed options there, since its pack suggestions are served from a room.
 */
export function premiseOf(ruleset: Ruleset | null): Premise | null {
  if (!ruleset) return null;
  for (const step of ruleset.checklist ?? []) {
    const done = step.done;
    if (done.count !== "entries" || done.field === undefined || done.equals !== undefined || done.prep !== undefined)
      continue;
    if (ruleset.codex?.kinds[done.kind]?.fields[done.field]?.visibility !== "party") continue;
    const fields = declaredFields({ ruleset, kind: done.kind })
      .filter((f) => ASKED.has(f.def.type))
      .map((f) => (f.def.type === "tags" ? { ...f, def: { ...f.def, entities: undefined } } : f));
    return { kind: done.kind, step, fields };
  }
  return null;
}

/** What the wizard asks of one game, read from its ruleset on the server so the page carries no manifest. */
export type WizardGame = {
  campaignFields: Record<string, CampaignField>;
  premise: Premise | null;
  /** The book's suggested lines to leave out (house decision #145), and their page. */
  examples: { lines: string[]; cite: string | null };
};

/** A pack the wizard offers for a game: ticked by the GM, or one the game module brings, which stays attached. */
export type OfferedPack = { slug: string; version: string; fromModule: boolean };
/** What each game of Choose game asks, by its key, with the packs it may use. */
export type WizardOptions = Record<string, WizardGame & { packs: OfferedPack[] }>;

export const wizardGame = (ruleset: Ruleset | null): WizardGame => ({
  campaignFields: ruleset?.campaignFields ?? {},
  premise: premiseOf(ruleset),
  examples: { lines: ruleset?.safetyExamples?.lines ?? [], cite: ruleset?.safetyExamples?.cite ?? null },
});

export type CampaignValue = number | string | boolean;

/** What the wizard collected, held in the page until CREATE. */
export type WizardDraft = {
  name: string;
  /** The ruleset by slug and version; null for a room from a game module (it names its own) or without a ruleset. */
  ruleset: { slug: string; version: string } | null;
  /** The packs ticked, beyond a game module's own. */
  packs: readonly { slug: string; version: string }[];
  fields: Readonly<Record<string, CampaignValue>>;
  premise: { kind: CodexKind; title: string; fields: Readonly<Record<string, EntryFieldValue | null>> } | null;
  safety: { lines: readonly string[]; veils: readonly string[]; xCard: boolean };
};

const filled = (v: EntryFieldValue | null): boolean => v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

/**
 * The wizard's room as a room document (house decision #143): its name and limits, the ruleset and packs it expects, the
 * campaign's values, and the premise as one entry the party sees. A part the GM left empty is left out of it.
 */
export function roomDocument({
  draft,
  newId = () => crypto.randomUUID(),
}: {
  draft: WizardDraft;
  newId?: () => string;
}): RoomDocumentInput {
  const { lines, veils, xCard } = draft.safety;
  const premise = Object.fromEntries(Object.entries(draft.premise?.fields ?? {}).filter(([, v]) => filled(v)));
  const expects = {
    ...(draft.ruleset ? { ruleset: draft.ruleset } : {}),
    ...(draft.packs.length > 0 ? { packs: [...draft.packs] } : {}),
  };
  return {
    format: ROOM_FORMAT,
    version: ROOM_VERSION,
    room: {
      name: draft.name.trim(),
      ...(lines.length > 0 || veils.length > 0 || xCard
        ? { safety: { lines: [...lines], veils: [...veils], xCard } }
        : {}),
    },
    ...(Object.keys(expects).length > 0 ? { expects } : {}),
    ...(Object.keys(draft.fields).length > 0 ? { campaignFields: { ...draft.fields } } : {}),
    ...(draft.premise && Object.keys(premise).length > 0
      ? {
          codex: [
            {
              id: newId(),
              kind: draft.premise.kind,
              title: draft.premise.title.trim(),
              visibility: "party" as const,
              fields: premise as Record<string, EntryFieldValue>,
            },
          ],
        }
      : {}),
  };
}

/** The wizard step a refusal's document path belongs to, so its message shows there; null for none of them. */
export function stepOfPath(path: string): WizardStep | null {
  const [head, next] = path.split(/[.[\]]+/);
  if (head === "room") return next === "safety" ? "table" : "name";
  if (head === "campaignFields") return "campaign";
  if (head === "codex") return "premise";
  if (head === "expects" || head === "module") return "game";
  if (head === "tableMode") return "table";
  return null;
}

/** The document checked as the server will first check it: the step and message of its first problem, or null. */
export function documentProblem(doc: RoomDocumentInput): { step: WizardStep | null; message: string } | null {
  const parsed = RoomDocument.safeParse(doc);
  const issue = parsed.success ? undefined : parsed.error.issues[0];
  return issue ? { step: stepOfPath(issue.path.join(".")), message: issue.message } : null;
}

/** Lines typed one per line: trimmed, blanks dropped. */
export const toLines = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
