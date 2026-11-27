import type { Ruleset } from "@inconsistable/rules-engine";

import type { AppLocale } from "@/lib/locale/locale";
import type { RoomWorld } from "@/lib/world/room";

import { appTerms, changedMessages, type MessageTree, roomTerms, withTerms } from "./terms";

type Messages = typeof import("../../messages/en.json");

const load = async (locale: AppLocale): Promise<Messages> =>
  ((await import(`../../messages/${locale}.json`)) as { default: Messages }).default;

/** A message file with its terms in the app's own words: what every page reads, a room's included. */
export async function appMessages(locale: AppLocale): Promise<Messages> {
  const raw = await load(locale);
  return withTerms(raw, appTerms(raw));
}

/**
 * The messages a room words differently from the app, in the viewer's language (issue #159): only those, so the page
 * sends the room's words beside the messages it already has instead of every message twice. Empty when the room's
 * World and ruleset change no word.
 */
export async function roomMessages({
  world,
  ruleset,
  locale,
}: {
  world: RoomWorld;
  ruleset: Pick<Ruleset, "terms" | "language"> | null;
  locale: AppLocale;
}): Promise<MessageTree> {
  const raw = await load(locale);
  const app = appTerms(raw);
  const words = roomTerms({ app, world: world?.terms, ruleset, lang: locale });
  return changedMessages(withTerms(raw, app), withTerms(raw, words));
}
