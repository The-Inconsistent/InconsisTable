import { redirect } from "next/navigation";

import { signedInUserId } from "@inconsistable/auth/next";

import { JOIN_ERRORS } from "@/app/constants";
import { apiGet } from "@/app/server-api";
import { LibraryView } from "@/components/library/library-view/library-view";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { PackList, RulesetList } from "@/lib/library/library";

// The signed-in user's imported rulesets and packs. The lists are read on the server; the page then refreshes after
// every import or delete.
export default async function LibraryPage() {
  if (!(await signedInUserId())) redirect("/sign-in");
  try {
    const [rulesets, packs] = await Promise.all([apiGet("/api/rulesets"), apiGet("/api/packs")]);
    const rulesetList = RulesetList.safeParse(rulesets.ok ? await rulesets.json() : null);
    const packList = PackList.safeParse(packs.ok ? await packs.json() : null);
    if (rulesetList.success && packList.success)
      return <LibraryView rulesets={rulesetList.data} packs={packList.data} />;
  } catch {
    // falls through to the same message as an answer we can't read
  }
  return <StatusScreen text={JOIN_ERRORS.nosignal} />;
}
