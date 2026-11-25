import { TAB_PARAM } from "../../components/gm/gm-app/constants.ts";
import { PLAYER_TABS, type PlayerTab } from "../../components/player/player-app/constants.ts";

// The phone's address (house decision #112): the open tab is `?tab=`, the same key the GM's page uses. Every other
// parameter (`quick`, anything unknown) is kept as it came.

/** The tab the query names, or null when it names none that exists. Whether the seat may open it is `settledTab`'s. */
export function parsePlayerTab(params: { get(key: string): string | null }): PlayerTab | null {
  const raw = params.get(TAB_PARAM);
  return PLAYER_TABS.find((t) => t === raw) ?? null;
}

/** The tab to show: the requested one when the seat may open it, else the default. */
export function settledTab({
  requested,
  allowed,
  fallback,
}: {
  requested: PlayerTab | null;
  allowed: readonly PlayerTab[];
  fallback: PlayerTab;
}): PlayerTab {
  return requested !== null && allowed.includes(requested) ? requested : fallback;
}

/** The query string (no `?`) with `tab` set and `keep`'s other parameters first, in their order. */
export function playerAddress({ tab, keep }: { tab: PlayerTab; keep: Iterable<[string, string]> }): string {
  const out = new URLSearchParams();
  for (const [k, v] of keep) if (k !== TAB_PARAM) out.append(k, v);
  out.set(TAB_PARAM, tab);
  return out.toString();
}
