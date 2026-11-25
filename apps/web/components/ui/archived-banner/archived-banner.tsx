"use client";
import { useTranslations } from "next-intl";

type ArchivedBannerProps = {
  /** Opens the place that reopens the room; absent for a seat that may not (no button is drawn). */
  onReopen?: () => void;
};

// A closed room is read-only (the server refuses every action but unarchive, delete, leaving and revoking access).
export function ArchivedBanner({ onReopen }: ArchivedBannerProps) {
  const t = useTranslations("archivedBanner");
  return (
    <div className="archived-banner" role="status">
      <strong>{t("title")}</strong>
      <span>{t("text")}</span>
      {onReopen && (
        <button className="btn sm" onClick={onReopen}>
          {t("reopen")}
        </button>
      )}
    </div>
  );
}
