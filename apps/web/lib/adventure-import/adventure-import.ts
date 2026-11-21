import {
  MENTION_RE,
  type ActionInput,
  type CodexKind,
  type RoomDocument,
  type RoomEntry,
} from "@inconsistable/core-schema";

// IMPORT ADVENTURE (house decision #103, parity rule 11): one or more adventures of a room document brought into a
// running room, sliced here in the GM's browser and sent as the table's ordinary codex actions. The source app's
// sliceAdventures and its name match (wrath_glory packages/shared/src/export.ts:155, campaign.service.ts), in the
// platform's terms. Everything here is pure: the screen runs the steps and holds the ids the room gives back.

/** The room's own ids for the document's: what each made or matched entry, and each uploaded picture, became. */
export type Ids = Record<string, string>;

/** One step, in the order it is sent. `makes` is the document id whose new id the action's answer carries. */
export type Step =
  | { kind: "action"; makes?: string; action: (ids: Ids) => ActionInput }
  | { kind: "picture"; imageId: string; mime: string; base64: string };

type Named = { id: string; kind: CodexKind; title: string };

export type AdventurePlan = {
  /** Entries the room does not have, made new and sealed, in the order they are made. */
  create: Named[];
  /** Entries the room has by kind and name: the scenes use the room's own (`to`), which stays as it is. */
  link: (Named & { to: string })[];
  pictures: number;
  /** References left out: a line or link naming something not brought, a Test taker the room has no one for. */
  dropped: number;
  steps: Step[];
};

/** The document's adventures, each with how many scenes it holds. */
export function adventuresIn(doc: RoomDocument): { id: string; title: string; scenes: number }[] {
  const codex = doc.codex ?? [];
  return codex
    .filter((e) => e.kind === "adventure")
    .map((a) => ({
      id: a.id,
      title: a.title,
      scenes: codex.filter((e) => e.kind === "scene" && e.parentId === a.id).length,
    }));
}

/** A name as two entries are matched by: trimmed, case-folded (the source app's `name.trim().toLowerCase()`). */
export const matchKey = (kind: string, title: string) => `${kind}/${title.trim().toLowerCase()}`;

const NEVER_MATCHED = new Set<CodexKind>(["adventure", "scene"]);

/** The ids an entry's texts, links, prepared lines and fields name. */
function namedBy(e: RoomEntry, ids: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const text of [e.body, e.gmNotes]) for (const m of (text ?? "").matchAll(MENTION_RE)) out.push(m[2] ?? "");
  out.push(...(e.links ?? []));
  out.push(...(e.prep?.exits ?? []).map((l) => l.sceneId));
  out.push(...(e.prep?.reveals ?? []).map((l) => l.entryId));
  out.push(...(e.prep?.picks ?? []).map((l) => l.entryId));
  out.push(...linkValues(e, ids));
  return out.filter((id) => ids.has(id));
}

/** The field values that name another entry of the document (a link field holds its id, house decision #76). */
const linkValues = (e: RoomEntry, ids: ReadonlySet<string>) =>
  Object.values(e.fields ?? {}).filter((v): v is string => typeof v === "string" && ids.has(v));

/**
 * The plan for bringing the picked adventures into a room: the adventures and their scenes, and what the scenes need
 * (the entries their texts mention, link, prepare a line for or name in a field, the entries those name in a field,
 * and the places above any of them). An entry the room already has by kind and name is linked, not made again;
 * adventures and scenes are always made. Everything arrives as unrevealed prep: scenes planned, no readers, no
 * picture shown, no pick switched on.
 */
export function planAdventures({
  doc,
  picked,
  room,
}: {
  doc: RoomDocument;
  picked: readonly string[];
  room: { entries: readonly Named[]; actors: readonly { id: string; name: string }[] };
}): AdventurePlan {
  const codex = doc.codex ?? [];
  const byId = new Map(codex.map((e) => [e.id, e]));
  const ids = new Set(byId.keys());
  const roomByName = new Map(room.entries.map((e) => [matchKey(e.kind, e.title), e]));
  const matched = new Map<string, string>();
  const match = (e: RoomEntry) => {
    if (NEVER_MATCHED.has(e.kind)) return false;
    const hit = roomByName.get(matchKey(e.kind, e.title));
    if (hit) matched.set(e.id, hit.id);
    return hit !== undefined;
  };

  const adventures = codex.filter((e) => e.kind === "adventure" && picked.includes(e.id));
  const scenes = codex.filter((e) => e.kind === "scene" && adventures.some((a) => a.id === e.parentId));
  const brought = new Set([...adventures, ...scenes].map((e) => e.id));
  const add = (id: string, follow: boolean) => {
    const e = byId.get(id);
    if (!e || brought.has(id) || NEVER_MATCHED.has(e.kind) || matched.has(id) || match(e)) return;
    brought.add(id);
    if (follow) for (const next of linkValues(e, ids)) add(next, false);
    if (e.parentId) add(e.parentId, false);
  };
  for (const e of [...adventures, ...scenes]) for (const id of namedBy(e, ids)) add(id, true);
  // The places above an entry brought by a field come too.
  for (const id of [...brought]) {
    const parent = byId.get(id)?.parentId;
    if (parent && !brought.has(parent)) add(parent, false);
  }

  // Parents before children; among siblings, the document's order of positions.
  const depth = (e: RoomEntry): number =>
    e.parentId && brought.has(e.parentId) ? depth(byId.get(e.parentId)!) + 1 : 0;
  const create = codex
    .filter((e) => brought.has(e.id))
    .map((e, i) => ({ e, i }))
    .sort(
      (a, b) =>
        depth(a.e) - depth(b.e) ||
        (a.e.position ?? Number.MAX_SAFE_INTEGER) - (b.e.position ?? Number.MAX_SAFE_INTEGER) ||
        a.i - b.i,
    )
    .map(({ e }) => e);

  const actorByName = new Map(room.actors.map((a) => [a.name.trim().toLowerCase(), a.id]));
  const docActor = new Map((doc.actors ?? []).map((a) => [a.id, a.name.trim().toLowerCase()]));
  let dropped = 0;
  const target = (id: string) => (brought.has(id) ? id : matched.has(id) ? id : null);
  const resolve = (ids: Ids, id: string) => ids[id] ?? matched.get(id) ?? id;
  const images = new Map((doc.images ?? []).map((p) => [p.id, p]));

  const steps: Step[] = create.map((e) => ({
    kind: "action" as const,
    makes: e.id,
    action: () => ({ type: "codex.save", kind: e.kind, title: e.title }),
  }));
  for (const e of create) {
    const parent = e.parentId ? target(e.parentId) : null;
    if (parent) {
      steps.push({
        kind: "action",
        action: (ids) => ({ type: "codex.move", id: ids[e.id]!, parentId: resolve(ids, parent), position: 10_000 }),
      });
    }
  }
  const picture = (e: RoomEntry) => (e.imageId ? images.get(e.imageId) : undefined);
  for (const p of new Map(create.flatMap((e) => (picture(e) ? [[picture(e)!.id, picture(e)!]] : []))).values()) {
    steps.push({ kind: "picture", imageId: p.id, mime: p.mime, base64: p.base64 });
  }

  for (const e of create) {
    const links = (e.links ?? []).filter((id) => target(id) !== null);
    dropped += (e.links?.length ?? 0) - links.length;
    const prep = e.prep && {
      ...e.prep,
      exits: (e.prep.exits ?? []).filter((l) => target(l.sceneId) !== null),
      reveals: (e.prep.reveals ?? []).filter((l) => target(l.entryId) !== null),
      picks: (e.prep.picks ?? [])
        .filter((l) => target(l.entryId) !== null)
        .map((l) => ({ ...l, rows: (l.rows ?? []).map(({ rowId }) => ({ rowId })) })),
      tests: (e.prep.tests ?? []).map((l) => {
        const takers = (l.actorIds ?? []).flatMap((a) => {
          const id = actorByName.get(docActor.get(a) ?? "");
          return id ? [id] : [];
        });
        dropped += (l.actorIds?.length ?? 0) - takers.length;
        return { ...l, actorIds: takers };
      }),
    };
    if (e.prep) {
      dropped += ["exits", "reveals", "picks"].reduce(
        (n, k) => n + ((e.prep![k as "exits"]?.length ?? 0) - (prep![k as "exits"]?.length ?? 0)),
        0,
      );
    }
    const linked = Object.entries(e.fields ?? {}).filter(([, v]) => typeof v === "string" && ids.has(v));
    dropped += linked.filter(([, v]) => target(v as string) === null).length;
    const pic = picture(e);
    steps.push({
      kind: "action",
      action: (got) => {
        const text = (s: string | undefined) =>
          s?.replace(MENTION_RE, (m, label: string, id: string) =>
            target(id) !== null ? `@[${label}](${resolve(got, id)})` : label,
          );
        const fields = Object.fromEntries(
          Object.entries(e.fields ?? {}).flatMap(([k, v]) =>
            typeof v === "string" && ids.has(v) ? (target(v) ? [[k, resolve(got, v)]] : []) : [[k, v]],
          ),
        );
        const p = prep && {
          ...prep,
          exits: prep.exits.map((l) => ({ ...l, sceneId: resolve(got, l.sceneId) })),
          reveals: prep.reveals.map((l) => ({ ...l, entryId: resolve(got, l.entryId) })),
          picks: prep.picks.map((l) => ({ ...l, entryId: resolve(got, l.entryId) })),
        };
        return {
          type: "codex.save",
          id: got[e.id]!,
          kind: e.kind,
          ...(e.body ? { body: text(e.body) } : {}),
          ...(e.gmNotes ? { gmNotes: text(e.gmNotes) } : {}),
          ...(Object.keys(fields).length ? { fields } : {}),
          ...(e.layout ? { layout: e.layout } : {}),
          ...(e.header ? { header: e.header } : {}),
          ...(e.source ? { source: e.source } : {}),
          ...(e.plannedTests?.length ? { plannedTests: e.plannedTests } : {}),
          ...(p ? { prep: p } : {}),
          ...(pic && got[pic.id] ? { imageId: got[pic.id] } : {}),
        } as ActionInput;
      },
    });
    for (const id of links) {
      steps.push({
        kind: "action",
        action: (got) => ({ type: "codex.link", id: got[e.id]!, targetId: resolve(got, id) }),
      });
    }
  }

  return {
    create: create.map(({ id, kind, title }) => ({ id, kind, title })),
    link: [...matched].map(([id, to]) => {
      const e = byId.get(id)!;
      return { id, kind: e.kind, title: e.title, to };
    }),
    pictures: steps.filter((s) => s.kind === "picture").length,
    dropped,
    steps,
  };
}
