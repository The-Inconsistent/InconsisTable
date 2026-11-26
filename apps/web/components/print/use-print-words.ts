"use client";
import { useTranslations } from "next-intl";

import type { PrintWords } from "@/lib/print/sheet";

/** The `print.words` namespace's `t`, as the printable models (lib/print) read it. */
export function usePrintWords(): PrintWords {
  const t = useTranslations("print.words");
  return (key, values) => t(key as Parameters<typeof t>[0], values);
}
