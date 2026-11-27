import type { Ruleset } from "@inconsistable/rules-engine";

import type { AppLocale } from "@/lib/locale/locale";
import type { RoomWorld } from "@/lib/world/room";

import { appTerms, roomTerms, type TermSet, withTerms } from "./terms";

type Messages = typeof import("../../messages/en.json");

/** A message file with its terms in the app's own words: what every page outside a room reads. */
export async function appMessages(locale: AppLocale): Promise<Messages> {
  const raw = ((await import(`../../messages/${locale}.json`)) as { default: Messages }).default;
  return withTerms(raw, appTerms(raw));
}

/**
 * A room's messages in the viewer's language, with the words the room's World and ruleset give its terms (issue #159).
 * Null when the room changes none of the app's words, so the page keeps the messages it already has.
 */
export async function roomMessages({
  world,
  ruleset,
  locale,
}: {
  world: RoomWorld;
  ruleset: Pick<Ruleset, "terms" | "language"> | null;
  locale: AppLocale;
}): Promise<Messages | null> {
  const raw = ((await import(`../../messages/${locale}.json`)) as { default: Messages }).default;
  const app: TermSet = appTerms(raw);
  const words = roomTerms({ app, world: world?.terms, ruleset, lang: locale });
  if (JSON.stringify(words) === JSON.stringify(app)) return null;
  return withTerms(raw, words);
}
