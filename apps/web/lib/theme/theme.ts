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

/** A device's colour set in a room whose World brings both: the system's, or one held whatever the system says. */
export const COLOUR_SCHEMES = ["system", "light", "dark"] as const;
export type ColourScheme = (typeof COLOUR_SCHEMES)[number];

/** The cookie that holds a device's colour set. Not httpOnly: the switch writes it from the browser. */
export const SCHEME_COOKIE = "INCONSISTABLE_SCHEME";

/** A device's colour set from its cookie; the system's for anything else. */
export const resolveScheme = (cookie: string | undefined): ColourScheme =>
  cookie === "light" || cookie === "dark" ? cookie : "system";

/** The root's `data-scheme` for a colour set: none when it follows the system. */
export const schemeAttribute = (scheme: ColourScheme) => (scheme === "system" ? undefined : scheme);

/** Remembers a device's colour set for a year (browser only). */
export function rememberScheme(scheme: ColourScheme): void {
  document.cookie = `${SCHEME_COOKIE}=${scheme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
