import { useTranslations } from "next-intl";

import { Marker } from "@inconsistable/core-schema";

type MarkerSwatchProps = { marker: Marker };

// A combatant's marker (house decision #92): the colour's square and its word, so it is never told by colour alone.
export function MarkerSwatch({ marker }: MarkerSwatchProps) {
  const t = useTranslations("marker");
  return (
    <span className="chip marker-chip" data-marker={marker} aria-label={t("swatch", { colour: t(marker) })}>
      <span className="marker-swatch" data-marker={marker} aria-hidden="true" />
      {t(marker)}
    </span>
  );
}

type MarkerPickerProps = {
  value: Marker | null;
  onPick: (marker: Marker | null) => void;
  /** Whose marker it is, for the group's name. */
  name: string;
};

// The marker picker: none, then each colour of the platform's list, the picked one pressed.
export function MarkerPicker({ value, onPick, name }: MarkerPickerProps) {
  const t = useTranslations("marker");
  return (
    <div className="row marker-picker" role="group" aria-label={t("pick", { name })}>
      <button type="button" className="btn sm" aria-pressed={value === null} onClick={() => onPick(null)}>
        {t("none")}
      </button>
      {Marker.options.map((m) => (
        <button key={m} type="button" className="btn sm" aria-pressed={value === m} onClick={() => onPick(m)}>
          <span className="marker-swatch" data-marker={m} aria-hidden="true" />
          {t(m)}
        </button>
      ))}
    </div>
  );
}
