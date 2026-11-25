"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, CodexEntry, LatestBegin, Me, PoolState } from "@inconsistable/core-schema";

import { LineText } from "@/components/gm/prep/components/line-text/line-text";
import { PoolsView } from "@/components/ui/pools-view/pools-view";
import { useLineSender } from "@/hooks/use-line-sender/use-line-sender";
import { useSummaryWords } from "@/hooks/use-summary-words/use-summary-words";
import type { Send } from "@/hooks/use-table/use-table";
import { poolSidesOf, poolSteps } from "@/lib/pools/pools";
import { scenePlay, scenePoolLines } from "@/lib/scene-play/scene-play";
import { lineName, lineNames, type PrepWorld } from "@/lib/scene-prep/scene-prep";

export type PoolPadProps = {
  pool: PoolState;
  me: Me;
  send: Send;
  world: PrepWorld;
  latestBegin: LatestBegin | null;
  sided: boolean;
};

// One pool's pad: the steps this seat is offered (the same as TRACK's, with the server's refusal under them) and the
// playing scene's planned spends of that pool.
export function PoolPad({ pool, me, send, world, latestBegin, sided }: PoolPadProps) {
  const playing = scenePlay(world.entries).playing;
  const lines = scenePoolLines({ entries: world.entries, pool: pool.id, world });
  const sides = poolSidesOf(me);
  return (
    <div className="stack">
      <PoolsView pools={[pool]} steps={(p) => poolSteps({ pool: p, ...sides })} send={send} />
      {playing && lines.length > 0 && (
        <PoolLines scene={playing} lines={lines} send={send} world={world} latestBegin={latestBegin} sided={sided} />
      )}
    </div>
  );
}

type PoolLinesProps = {
  scene: CodexEntry;
  lines: ReturnType<typeof scenePoolLines>;
  send: Send;
  world: PrepWorld;
  latestBegin: LatestBegin | null;
  sided: boolean;
};

// The scene's pool lines, sent as the scene page sends them (use-line-sender); a refusal shows under the list.
function PoolLines({ scene, lines, send, world, latestBegin, sided }: PoolLinesProps) {
  const t = useTranslations("pools");
  const tPrep = useTranslations("prep");
  const words = useSummaryWords();
  const [error, setError] = useState<string | null>(null);
  const names = lineNames(world);
  // Sends an action and keeps its refusal, if any.
  const act = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r;
  };
  const sender = useLineSender({ scene, world, names, act, sided, latestBegin, onOpenScene: () => undefined });
  return (
    <section className="stack" aria-label={t("planned")}>
      <h3 className="head">{t("planned")}</h3>
      <ul className="list">
        {lines.map(({ line, resolved }) => {
          const what = lineName({ kind: "pools", line, names, t: words });
          return (
            <li key={line.id} className="row between" style={{ flexWrap: "wrap", alignItems: "start" }}>
              <span style={{ flex: "1 1 160px", minWidth: 0 }}>
                <LineText kind="pools" line={line} names={names} resolved={resolved} />
              </span>
              <button
                className="btn primary"
                aria-label={tPrep("sendLine", { what })}
                aria-busy={sender.busy === line.id}
                disabled={resolved.state !== "ready" || sender.busy !== null}
                onClick={resolved.state === "ready" ? sender.handleSend(line.id, what, resolved.action) : undefined}
              >
                {tPrep("send")}
              </button>
            </li>
          );
        })}
      </ul>
      {sender.sent && !error && <p className="small dim">{sender.sent}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
