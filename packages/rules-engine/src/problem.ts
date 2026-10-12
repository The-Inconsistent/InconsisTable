/** One reason a manifest was refused, with the path of the offending entry, e.g. `resources[2].cite`. */
export interface Problem {
  path: string;
  message: string;
}

export type PathPart = string | number | symbol;

/** `["resources", 2, "cite"]` → `resources[2].cite`, the form an importer can show next to the field. */
export function formatPath(parts: readonly PathPart[]): string {
  let out = "";
  for (const p of parts) {
    if (typeof p === "number") out += `[${p}]`;
    else out += out === "" ? String(p) : `.${String(p)}`;
  }
  return out === "" ? "(root)" : out;
}
