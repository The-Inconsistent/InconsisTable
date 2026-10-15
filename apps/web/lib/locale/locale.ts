export const LOCALES = ["en", "vi"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";

/** The cookie that holds a device's language. Not httpOnly: the switch writes it from the browser. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLocale = (v: unknown): v is AppLocale =>
  typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** The first language of an Accept-Language header that the app has, by weight; null when none is en or vi. */
function fromAcceptLanguage(header: string | null | undefined): AppLocale | null {
  const ranked = (header ?? "")
    .split(",")
    .map((part, order) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = Number(
        params
          .find((p) => p.trim().startsWith("q="))
          ?.trim()
          .slice(2) ?? 1,
      );
      return { primary: tag.trim().toLowerCase().split("-")[0], q: Number.isNaN(q) ? 0 : q, order };
    })
    .filter((l) => l.q > 0)
    .sort((a, b) => b.q - a.q || a.order - b.order);
  return ranked.map((l) => l.primary).find(isLocale) ?? null;
}

/** Remembers a device's language for a year (browser only). */
export function rememberLocale(locale: AppLocale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** A device's language: its cookie, else the browser's Accept-Language, else English. */
export function resolveLocale({
  cookie,
  acceptLanguage,
}: {
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): AppLocale {
  if (isLocale(cookie)) return cookie;
  return fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
