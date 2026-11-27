import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { LOCALE_COOKIE, resolveLocale } from "@/lib/locale/locale";
import { appMessages } from "@/lib/terms/room-messages";

// next-intl without i18n routing: the language belongs to the device (cookie, else Accept-Language), never to the URL.
// The messages name the app's terms (`[party]`, issue #159); outside a room they read the app's own words.
export default getRequestConfig(async () => {
  const locale = resolveLocale({
    cookie: (await cookies()).get(LOCALE_COOKIE)?.value,
    acceptLanguage: (await headers()).get("accept-language"),
  });
  return { locale, messages: await appMessages(locale) };
});
