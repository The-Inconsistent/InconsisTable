// The next session's date (#220, Auspex P37): stored as UTC, typed and shown in each viewer's own time zone.

const pad = (n: number) => String(n).padStart(2, "0");

/** A stored date as a `datetime-local` input's value, in this browser's zone ("" for none). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value, read in this browser's zone, as the UTC date campaign.update takes (null for none). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value); // a date-time with no offset is local time (ECMAScript Date.parse)
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** How the date is shown, through next-intl's `format.dateTime` in the viewer's zone: "Sat, 12 Dec, 18:00". */
export const NEXT_SESSION_FORMAT = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
} as const satisfies Intl.DateTimeFormatOptions;
