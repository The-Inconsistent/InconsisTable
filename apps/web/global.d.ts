import type { AppLocale } from "./lib/locale/locale";
import type en from "./messages/en.json";

// Typed messages: a key that is not in en.json is a type error. vi.json is held to the same keys by a test.
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof en;
  }
}
