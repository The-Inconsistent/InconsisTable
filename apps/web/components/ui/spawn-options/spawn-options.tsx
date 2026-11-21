import { useTranslations } from "next-intl";

import type { SpawnOption } from "@inconsistable/rules-engine";

import { toggled } from "@/lib/spawn/spawn";

type SpawnOptionsProps = {
  options: readonly SpawnOption[];
  value: readonly string[];
  onChange: (ids: string[]) => void;
  /** What is being spawned, for the group's name. */
  name: string;
};

// The ruleset's spawn options an entry may take (house decision #92), each a toggle; they add up. Nothing when none.
export function SpawnOptions({ options, value, onChange, name }: SpawnOptionsProps) {
  const t = useTranslations("spawnOptions");
  if (options.length === 0) return null;
  return (
    <div className="stack" role="group" aria-label={t("pick", { name })}>
      <span className="small">{t("title")}</span>
      <div className="row">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="btn sm"
            aria-pressed={value.includes(o.id)}
            onClick={() => onChange(toggled({ ids: value, id: o.id }))}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
