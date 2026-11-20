"use client";
import { useTranslations } from "next-intl";

import type { SummaryWords } from "@/lib/scene-prep/scene-prep";

/** The prep namespace's `t`, as a prepared line's summary and name read it (lib/scene-prep). */
export function useSummaryWords(): SummaryWords {
  const t = useTranslations("prep");
  return (key, values) => t(key as Parameters<typeof t>[0], values);
}
