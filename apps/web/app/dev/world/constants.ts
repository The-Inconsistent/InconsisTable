/** Which of a sample World's sets the page lays out: both, as written, or only one. */
export const SET_CHOICES = ["both", "light", "dark"] as const;
export type SetChoice = (typeof SET_CHOICES)[number];

/** The stand-in table at the table's density or the TV's. */
export const DENSITIES = ["table", "tv"] as const;
export type Density = (typeof DENSITIES)[number];
