"use client";
import { useTranslations } from "next-intl";

import type { Notice } from "@inconsistable/core-schema";

type ActionNoticesProps = {
  /** The last accepted action's notices, as this seat's answer carried them (`useTable().notices`). */
  notices: readonly Notice[];
  onDismiss: () => void;
};

// What the last action this seat sent did beyond itself (house decision #79): a ruleset's line in its own words, or
// the platform's worded here. Not an error: told politely, gone with the next action or the dismiss.
export function ActionNotices({ notices, onDismiss }: ActionNoticesProps) {
  const t = useTranslations("actionNotices");
  return (
    <div className="stack spend-notices" role="status" aria-live="polite" aria-label={t("label")}>
      {notices.length > 0 && (
        <div className="spend-notice row action-notices">
          <ul className="stack">
            {notices.map((n, i) => (
              <li key={i}>{n.text ?? t(n.code, n.params)}</li>
            ))}
          </ul>
          <button className="btn sm" onClick={onDismiss}>
            {t("dismiss")}
          </button>
        </div>
      )}
    </div>
  );
}
