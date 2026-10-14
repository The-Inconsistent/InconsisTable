import type { CompiledRuleset } from "./compile.ts";
import type { FieldValue } from "./derived.ts";
import type { Visibility, ViewerRole } from "./enums.ts";
import { own } from "./own.ts";

export interface Viewer {
  role: ViewerRole;
  /** The actors this seat holds (one seat, several characters: the view is their union). */
  characterIds: readonly string[];
}

/** One actor as a snapshot carries it, and as a viewer receives it with hidden entries dropped. */
export interface ActorView {
  id: string;
  /** Entity type id from the manifest. */
  entity: string;
  fields: Readonly<Record<string, FieldValue>>;
  resources: Readonly<Record<string, number>>;
  derived: Readonly<Record<string, number>>;
  conditions: readonly string[];
}

export interface ViewerView {
  viewer: Viewer;
  actors: ActorView[];
}

/** Tier 2 of §5.5: a ruleset's own view function, which may transform values and not only hide them. */
export type RulesetView = (view: ViewerView) => ViewerView;

/** Whether a viewer may see a value of the given visibility on the given actor. */
export function canSee({
  visibility,
  viewer,
  actorId,
}: {
  visibility: Visibility;
  viewer: Viewer;
  actorId: string;
}): boolean {
  // Who counts as a `gm` for which actor is the api's Seat view module's call; it hands a co-GM the role it earns.
  if (viewer.role === "gm") return true;
  switch (visibility) {
    case "public":
      return true;
    case "party":
      return viewer.role === "player" || viewer.role === "screen";
    case "owner":
      return viewer.role === "player" && viewer.characterIds.includes(actorId);
    case "gm":
      return false;
  }
}

function keep<T>({
  values,
  visibilityOf,
  viewer,
  actorId,
}: {
  values: Readonly<Record<string, T>>;
  visibilityOf: (id: string) => Visibility;
  viewer: Viewer;
  actorId: string;
}): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).filter(([id]) => canSee({ visibility: visibilityOf(id), viewer, actorId })),
  );
}

/**
 * Filter actors for one viewer by declared visibility, then hand the result to the ruleset's view function.
 * Fail-closed: anything the manifest does not declare (a field, a resource, an unknown entity type) is `gm`.
 */
export function toViewerView({
  compiled,
  viewer,
  actors,
  rulesetView,
}: {
  compiled: CompiledRuleset;
  viewer: Viewer;
  actors: readonly ActorView[];
  rulesetView?: RulesetView;
}): ViewerView {
  const filtered = actors.map((actor): ActorView => {
    const entity = own(compiled.entities, actor.entity);
    const derivedVis = new Map(entity?.derived.map((d) => [d.id, d.visibility]) ?? []);
    const common = { viewer, actorId: actor.id };
    return {
      id: actor.id,
      entity: actor.entity,
      fields: keep({
        ...common,
        values: actor.fields,
        visibilityOf: (id) => (entity === undefined ? "gm" : (own(entity.def.fields, id)?.visibility ?? "gm")),
      }),
      resources: keep({
        ...common,
        values: actor.resources,
        visibilityOf: (id) => own(compiled.resources, id)?.def.visibility ?? "gm",
      }),
      derived: keep({ ...common, values: actor.derived, visibilityOf: (id) => derivedVis.get(id) ?? "gm" }),
      conditions: actor.conditions.filter((id) =>
        canSee({ ...common, visibility: own(compiled.conditions, id)?.visibility ?? "gm" }),
      ),
    };
  });
  const view: ViewerView = { viewer, actors: filtered };
  return rulesetView === undefined ? view : rulesetView(view);
}
