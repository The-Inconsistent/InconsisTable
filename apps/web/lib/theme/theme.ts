export const THEMES = ["lantern", "felt"] as const;
export type AppTheme = (typeof THEMES)[number];

/** The cookie that holds a device's Theme. Not httpOnly: the switch writes it from the browser. */
export const THEME_COOKIE = "INCONSISTABLE_THEME";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** A device's Theme from its cookie; lantern, the base Theme, for anything else. */
export const resolveTheme = (cookie: string | undefined): AppTheme => (cookie === "felt" ? "felt" : "lantern");

/** The root class a Theme needs: the base Theme is the default tokens, felt re-maps them under `.theme-felt`. */
export const themeClass = (theme: AppTheme) => (theme === "felt" ? "theme-felt" : "");

/** Remembers a device's Theme for a year (browser only). */
export function rememberTheme(theme: AppTheme): void {
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
