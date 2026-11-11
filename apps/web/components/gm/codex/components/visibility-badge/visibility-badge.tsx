import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";

// Who can read an entry, in words: gm, party or public, and "listed" when only chosen characters do.
export function VisibilityBadge({ entry }: { entry: CodexEntry }) {
  const t = useTranslations("codex");
  return (
    <span className="chip">
      {t(`visibility.${entry.visibility}`)}
      {entry.visibility !== "gm" &&
        entry.audienceMode === "listed" &&
        ` · ${t("listed", { count: entry.audience.length })}`}
    </span>
  );
}
