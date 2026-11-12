import { useTranslations } from "next-intl";

import type { Clock } from "@inconsistable/core-schema";

import { clampFilled, wedgePath } from "@/lib/clock/clock";

type ClockFaceProps = { clock: Pick<Clock, "name" | "segments" | "filled"> };

// A progress clock: a brass-rimmed disc cut into wedges. A lit wedge sits over a dark one and fades and swells in when
// it fills (the motion is in globals.css), so a tick is seen and not only read. The count is also written beside it.
export function ClockFace({ clock }: ClockFaceProps) {
  const t = useTranslations("clocks");
  const filled = clampFilled(clock);
  return (
    <svg
      className="clock-face"
      viewBox="0 0 100 100"
      role="img"
      aria-label={t("label", { name: clock.name, filled, segments: clock.segments })}
      data-full={filled === clock.segments}
    >
      <circle className="clock-rim" cx="50" cy="50" r="48.5" />
      {Array.from({ length: clock.segments }, (_, index) => {
        const d = wedgePath({ index, segments: clock.segments });
        return (
          <g key={index}>
            <path className="clock-wedge" d={d} />
            <path className="clock-wedge lit" d={d} data-lit={index < filled} />
          </g>
        );
      })}
      <circle className="clock-hub" cx="50" cy="50" r="5" />
    </svg>
  );
}
