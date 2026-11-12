"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { Actor, RequestAnswer } from "@inconsistable/core-schema";

import { unseen } from "@/lib/spend-request/spend-request";

type RequestNoticesProps = {
  answers: readonly RequestAnswer[];
  actors: readonly Actor[];
  /** The resource labels of the pinned ruleset; an id stands in when it is not loaded. */
  labels: ReadonlyMap<string, string>;
};

const NOTICE_MS = 8000;

// A brief notice for each answer the GM gives while this phone is open: approved, or denied with the reason. What was
// already answered when the phone connected is not shown again.
export function RequestNotices({ answers, actors, labels }: RequestNoticesProps) {
  const t = useTranslations("spendRequest");
  // The answers the snapshot already held at mount are old news; later ones are shown until dismissed.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(answers.map((a) => a.id)));
  const fresh = unseen({ answers, seen });
  const oldest = fresh[0]?.id;

  // External system: a timer that lets a notice go by itself after a few seconds.
  useEffect(() => {
    if (!oldest) return;
    const timer = setTimeout(() => setSeen((s) => new Set(s).add(oldest)), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [oldest]);

  if (fresh.length === 0) return null;
  return (
    <div className="stack spend-notices">
      {fresh.map((a) => {
        const values = {
          amount: a.amount,
          label: labels.get(a.resourceId) ?? a.resourceId,
          name: actors.find((x) => x.id === a.actorId)?.name ?? "",
          reason: a.reason,
        };
        return (
          <div key={a.id} className="spend-notice row" role="status" data-status={a.status}>
            <span>
              {a.status === "approved"
                ? t("approved", values)
                : a.reason
                  ? t("deniedWhy", values)
                  : t("denied", values)}
            </span>
            <button className="btn sm" onClick={() => setSeen((s) => new Set(s).add(a.id))}>
              {t("dismiss")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
