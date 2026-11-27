import type { BookPage } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

/** The PDF page a printed page is on: the printed page plus its source's `pageOffset` (the manifest's `Source`). */
export function pdfPage({ page, sources }: { page: BookPage; sources: Ruleset["sources"] }): number {
  return page.page + (sources.find((s) => s.id === page.source)?.pageOffset ?? 0);
}

/** The first encoding of a drawn page at or under `max` bytes, trying each quality in order; null when none fits. */
export async function fitPage({
  encode,
  qualities,
  max,
}: {
  encode: (quality: number) => Promise<Blob | null>;
  qualities: readonly number[];
  max: number;
}): Promise<Blob | null> {
  for (const q of qualities) {
    const blob = await encode(q);
    if (blob && blob.size <= max) return blob;
  }
  return null;
}
