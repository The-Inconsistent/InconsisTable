import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { WorldDev } from "./world-dev";

export async function generateMetadata() {
  const t = await getTranslations("world.dev");
  return { title: t("title") };
}

// Dev only: a stand-in table wearing an invented World, with a control for every pick. Answers 404 outside `next dev`,
// as /dev/seed does.
export default function WorldDevPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <WorldDev />;
}
