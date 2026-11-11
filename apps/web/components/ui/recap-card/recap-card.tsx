"use client";
import { useTranslations } from "next-intl";

import type { SessionRecap } from "@inconsistable/core-schema";

type RecapCardProps = { recap: SessionRecap; onDismiss?: () => void };

// "Last time...": the newest recap at the start of a session. On the TV it reads at the density's far-away size; on a
// phone it carries a dismiss button.
export function RecapCard({ recap, onDismiss }: RecapCardProps) {
  const t = useTranslations("recaps");
  return (
    <section className="card" aria-label={t("lastTime")}>
      <h2 className="head" style={{ fontSize: "var(--fs-name)" }}>
        {t("lastTime")}
      </h2>
      <strong>{[t("session", { number: recap.number }), recap.title].filter(Boolean).join(": ")}</strong>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{recap.recap}</p>
      {onDismiss && (
        <button className="btn" onClick={onDismiss} style={{ justifySelf: "start" }}>
          {t("dismiss")}
        </button>
      )}
    </section>
  );
}
