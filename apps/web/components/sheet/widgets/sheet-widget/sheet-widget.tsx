"use client";
import type { WidgetModel } from "@/lib/sheet-widgets/sheet-widgets";

import { Cards } from "../cards/cards";
import { Folds } from "../folds/folds";
import { Frames } from "../frames/frames";
import { Grid } from "../grid/grid";
import { Notes } from "../notes/notes";
import { Pips } from "../pips/pips";
import { Strip } from "../strip/strip";
import { Sum } from "../sum/sum";
import { Track } from "../track/track";
import type { WidgetEnv } from "../types";

// One widget of a sheet section (house decision #83), under the layout row's own label when it has one. Every widget
// draws with the Theme's tokens only; the model holds only what this seat received.
export function SheetWidget({ model, env }: { model: WidgetModel; env: WidgetEnv }) {
  const body = () => {
    switch (model.widget) {
      case "strip":
        return <Strip title={model.title} values={model.values} env={env} />;
      case "grid":
        return <Grid model={model} env={env} />;
      case "frames":
        return <Frames values={model.values} env={env} />;
      case "sum":
        return <Sum parts={model.parts} total={model.total} env={env} />;
      case "track":
        return <Track value={model.value} max={model.max} env={env} />;
      case "pips":
        return <Pips value={model.value} steps={model.steps} env={env} />;
      case "cards":
        return <Cards model={model} env={env} />;
      case "folds":
        return <Folds model={model} env={env} />;
      case "notes":
        return <Notes fields={model.fields} env={env} />;
    }
  };
  return (
    <div className="w" data-widget={model.widget}>
      {model.label && <h3 className="w-label">{model.label}</h3>}
      {body()}
    </div>
  );
}
