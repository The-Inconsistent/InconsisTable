"use client";
import { useMemo } from "react";

import type { Codex, LiveState, Me } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { PoolButton } from "@/components/gm/header/pool-button/pool-button";
import type { Send } from "@/hooks/use-table/use-table";
import { prepWorld, type Spawnable } from "@/lib/scene-prep/scene-prep";

type HeaderPoolsProps = {
  me: Me;
  state: LiveState;
  codex: Codex | null;
  ruleset: Ruleset | null;
  spawnable: Spawnable | null;
  send: Send;
};

// A button per shared pool in the seat's own list (a pool the seat is not sent is never drawn, house decision #59).
export function HeaderPools({ me, state, codex, ruleset, spawnable, send }: HeaderPoolsProps) {
  const entries = useMemo(() => codex?.entries ?? [], [codex]);
  const world = useMemo(() => prepWorld({ state, entries, spawnable, ruleset }), [state, entries, spawnable, ruleset]);
  return (
    <>
      {state.pools.map((pool) => (
        <PoolButton
          key={pool.id}
          pool={pool}
          me={me}
          send={send}
          world={world}
          latestBegin={codex?.latestBegin ?? null}
          sided={ruleset?.initiative?.strategy === "sides"}
        />
      ))}
    </>
  );
}
