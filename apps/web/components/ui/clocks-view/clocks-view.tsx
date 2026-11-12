import { useTranslations } from "next-intl";

import type { Clock } from "@inconsistable/core-schema";

import { ClockFace } from "@/components/ui/clock-face/clock-face";

type ClocksViewProps = { clocks: readonly Clock[] };

// The clocks as a seat that doesn't run them sees them (a phone, the table screen): the face and the name, nothing to
// tap. The seat was only sent the clocks the GM shows the table. Nothing when there are none.
export function ClocksView({ clocks }: ClocksViewProps) {
  const t = useTranslations("clocks");
  if (clocks.length === 0) return null;
  return (
    <section className="stack" aria-label={t("title")}>
      <ul className="clock-grid">
        {clocks.map((clock) => (
          <li key={clock.id} className="clock-tile">
            <ClockFace clock={clock} />
            <span className="clock-name">{clock.name}</span>
            <span className="clock-count">
              {clock.filled === clock.segments
                ? t("full")
                : t("progress", { filled: clock.filled, segments: clock.segments })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
