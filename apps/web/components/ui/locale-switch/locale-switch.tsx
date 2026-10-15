"use client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { LOCALES, rememberLocale, type AppLocale } from "@/lib/locale/locale";

// EN | VI: the device's language. It lives in a cookie so a guest can switch without an account; the page then
// refreshes so the server renders the new language.
export function LocaleSwitch() {
  const t = useTranslations("localeSwitch");
  const current = useLocale();
  const router = useRouter();

  const handlePick = (locale: AppLocale) => {
    rememberLocale(locale);
    router.refresh();
  };

  return (
    <span className="seg" role="group" aria-label={t("label")}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          className="btn sm"
          lang={locale}
          aria-pressed={current === locale}
          aria-label={t(`name.${locale}`)}
          onClick={() => handlePick(locale)}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </span>
  );
}
