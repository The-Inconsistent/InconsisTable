"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { TableMode, canInCampaign, type LiveState, type Me } from "@inconsistable/core-schema";
import { modesOf, type Ruleset } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";

type TableModePickerProps = { me: Me; state: LiveState; ruleset: Ruleset | null; send: Send };

// HOW THE TABLE SITS: the owner changes it between sessions, among the modes the game is played in. The api refuses it
// during a session and for a mode the ruleset lacks; this only offers what can work.
export function TableModePicker({ me, state, ruleset, send }: TableModePickerProps) {
  const t = useTranslations("tableMode");
  const tModes = useTranslations("tableModes");
  const [error, setError] = useState<string | null>(null);
  if (!canInCampaign({ ctx: me, perm: "campaign:table_mode" })) return null;
  const modes = ruleset ? modesOf(ruleset) : ["gm" as const];
  if (modes.length < 2) return null;

  const handlePick = async (mode: TableMode) => {
    const r = await send({ type: "campaign.setTableMode", mode });
    setError(r.ok ? null : r.error);
  };

  return (
    <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }} disabled={state.session !== null}>
      <legend className="head">{t("title")}</legend>
      <div className="row">
        {modes.map((m) => (
          <button key={m} className="btn" aria-pressed={state.campaign.tableMode === m} onClick={() => handlePick(m)}>
            {tModes(m)}
          </button>
        ))}
      </div>
      {state.session !== null && <p className="small dim">{t("betweenSessions")}</p>}
      {state.campaign.tableMode === "gm" && <p className="small dim">{t("becomesVisible")}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
