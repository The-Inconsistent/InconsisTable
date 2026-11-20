import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { LedgerDev } from "./ledger-dev";

export async function generateMetadata() {
  const t = await getTranslations("ledgerBuilder.dev");
  return { title: t("title") };
}

// Dev only: the ledger builder on the engine's invented game, to look at before the api serves a catalogue. Answers 404
// outside `next dev`, as /dev/seed does.
export default function LedgerDevPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <LedgerDev />;
}
