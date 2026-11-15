import { readJson } from "@/lib/api-reply/api-reply";
import { RulesetImported } from "@/lib/library/library";

import { FREEFORM } from "./freeform";

/**
 * Freeform into the caller's own library, through the ordinary owner-scoped import. Importing the same manifest again
 * answers `unchanged` with the same version, so a second tap (or a second device) makes no second copy. Null: refused.
 */
export async function importFreeform(): Promise<string | null> {
  const res = await fetch("/api/rulesets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(FREEFORM),
  });
  const parsed = RulesetImported.safeParse(await readJson(res));
  return res.ok && parsed.success ? parsed.data.versionId : null;
}
