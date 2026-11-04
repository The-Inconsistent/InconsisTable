export const THEMES = ["lantern", "felt", "velvet"] as const;
export type AppTheme = (typeof THEMES)[number];

/** The cookie that holds a device's Theme. Not httpOnly: the switch writes it from the browser. */
export const THEME_COOKIE = "INCONSISTABLE_THEME";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const isTheme = (value: string | undefined): value is AppTheme => THEMES.some((theme) => theme === value);

/** A device's Theme from its cookie; lantern, the base Theme, for anything else. */
export const resolveTheme = (cookie: string | undefined): AppTheme => (isTheme(cookie) ? cookie : "lantern");

/** The root class a Theme needs: the base Theme is the default tokens, every other one re-maps them under `.theme-<name>`. */
export const themeClass = (theme: AppTheme) => (theme === "lantern" ? "" : `theme-${theme}`);

/** The Theme a root class list carries; lantern when it carries none. */
export const themeOf = (classes: DOMTokenList): AppTheme =>
  THEMES.find((theme) => theme !== "lantern" && classes.contains(themeClass(theme))) ?? "lantern";

/** Puts a Theme on the root element at once (browser only): drops every other Theme's class. */
export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement;
  for (const other of THEMES) {
    const name = themeClass(other);
    if (name) root.classList.toggle(name, other === theme);
  }
}

/** Remembers a device's Theme for a year (browser only). */
export function rememberTheme(theme: AppTheme): void {
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
