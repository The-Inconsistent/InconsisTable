// An @mention of a codex entry, as stored in a body: `@[Title](entry-id)`. A seat that cannot see the entry receives
// `@[…](hidden)` instead, so neither the title nor the id of a hidden entry leaves the server. Go twin: view/mention.go.
export const MENTION_RE = /@\[([^\]\n]*)\]\(([^)\s]+)\)/g;
export const HIDDEN_MENTION = "@[…](hidden)";

/** Keeps a title inside the brackets of a mention. */
export const mentionOf = ({ id, title }: { id: string; title: string }): string =>
  `@[${title.replace(/[[\]\n]/g, " ").trim()}](${id})`;

/** The mentions of a body that the seat cannot read become the hidden form; the rest stay. */
export const hideMentions = ({ body, canSee }: { body: string; canSee: (id: string) => boolean }): string =>
  body.replace(MENTION_RE, (m, _title: string, id: string) => (canSee(id) ? m : HIDDEN_MENTION));

export type BodyPart = { text: string } | { title: string; id: string };

/** A body cut into text and mentions, for rendering. */
export function splitMentions(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ title: m[1] ?? "", id: m[2] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}
