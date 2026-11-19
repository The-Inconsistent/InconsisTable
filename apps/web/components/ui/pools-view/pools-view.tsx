"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { PoolState } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { poolFraction, poolStepLimits } from "@/lib/pools/pools";

type PoolsViewProps = {
  pools: readonly PoolState[];
  /** Which buttons a pool gets; leave out (the TV) for a read-only list. */
  steps?: (pool: PoolState) => { dec: boolean; inc: boolean };
  send?: Send;
};

// The shared pools a seat received: label, a large value, the maximum and a bar when there is one. A button the seat may
// not press is not drawn; the server is the authority and its refusal shows under the list. Nothing when there are none.
export function PoolsView({ pools, steps, send }: PoolsViewProps) {
  const t = useTranslations("pools");
  const [error, setError] = useState<string | null>(null);
  if (pools.length === 0) return null;

  // STEP: adds or takes one from a pool; the server clamps and may refuse.
  const step = async (pool: PoolState, delta: number) => {
    if (!send) return;
    const r = await send({
      type: "rule.op",
      primitive: "resource.capped",
      op: "adjustPool",
      input: { resource: pool.id, delta },
    });
    setError(r.ok ? null : r.error);
  };

  return (
    <div className="stack pools-view">
      <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {pools.map((pool) => {
          const can = send && steps ? steps(pool) : { dec: false, inc: false };
          const { decDisabled, incDisabled } = poolStepLimits(pool);
          const fraction = poolFraction(pool);
          return (
            <li key={pool.id} className="card stack" data-stat={pool.id} data-kind="pool">
              <div className="sheet-row">
                <span className="stat-label">{pool.label}</span>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  {can.dec && (
                    <button
                      className="btn step"
                      aria-label={t("take", { label: pool.label })}
                      disabled={decDisabled}
                      onClick={() => step(pool, -1)}
                    >
                      −
                    </button>
                  )}
                  <strong
                    className="sheet-num"
                    aria-label={
                      pool.max !== null
                        ? t("valueOf", { label: pool.label, value: pool.value, max: pool.max })
                        : t("value", { label: pool.label, value: pool.value })
                    }
                  >
                    {pool.value}
                    {pool.max !== null && <span className="dim small"> / {pool.max}</span>}
                  </strong>
                  {can.inc && (
                    <button
                      className="btn step"
                      aria-label={t("add", { label: pool.label })}
                      disabled={incDisabled}
                      onClick={() => step(pool, 1)}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
              {fraction !== null && (
                <span className="bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${fraction})` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
