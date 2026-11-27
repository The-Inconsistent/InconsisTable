"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

type ConfirmButtonProps = {
  /** The action's word ("Revoke guest"). */
  label: string;
  /** Names the action and its target, for a screen reader ("Revoke guest of Ash"). */
  ariaLabel?: string;
  onConfirm: () => void;
  className?: string;
  /** A line shown beside it while it waits for the second tap ("Nobody can undo a deal."). */
  warning?: string;
};

// A one-way action behind a second tap on the same place (as PREP's DELETE): the first tap turns the button into
// "… : tap again" with CANCEL beside it; no dialog, so the table stays in view.
export function ConfirmButton({ label, ariaLabel, onConfirm, className = "btn", warning }: ConfirmButtonProps) {
  const t = useTranslations("confirmButton");
  const [armed, setArmed] = useState(false);

  // The second tap: the action, and the button back to its word.
  const handleConfirm = () => {
    setArmed(false);
    onConfirm();
  };

  if (!armed)
    return (
      <button className={className} aria-label={ariaLabel} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  return (
    <span className="row" style={{ gap: 6 }}>
      <button
        className={className}
        aria-label={ariaLabel && t("againLabel", { action: ariaLabel })}
        onClick={handleConfirm}
      >
        {t("again", { action: label })}
      </button>
      <button className={className} onClick={() => setArmed(false)}>
        {t("cancel")}
      </button>
      {warning && (
        <span className="dim" role="status">
          {warning}
        </span>
      )}
    </span>
  );
}
