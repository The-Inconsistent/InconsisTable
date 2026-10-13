// Where in a JSON text a validator path such as `entries[3].body.attr.str` points, so the importer can select it for
// the owner. A small scanner over the text rather than JSON.parse, because parse throws the positions away.

export interface Located {
  start: number;
  end: number;
  /** false: the path names something that is not in the text (a missing cite); the nearest object it reached is marked. */
  exact: boolean;
}

const skipWs = (t: string, from: number) => {
  let i = from;
  while (i < t.length && /\s/.test(t.charAt(i))) i++;
  return i;
};

const skipString = (t: string, from: number) => {
  let i = from + 1;
  while (i < t.length && t.charAt(i) !== '"') i += t.charAt(i) === "\\" ? 2 : 1;
  return Math.min(i + 1, t.length);
};

function skipValue(t: string, from: number): number {
  let i = skipWs(t, from);
  const c = t.charAt(i);
  if (c === '"') return skipString(t, i);
  if (c === "{" || c === "[") {
    const close = c === "{" ? "}" : "]";
    i++;
    while (i < t.length) {
      i = skipWs(t, i);
      const d = t.charAt(i);
      if (d === close) return i + 1;
      if (d === "," || d === ":") i++;
      else i = Math.max(skipValue(t, i), i + 1);
    }
    return i;
  }
  while (i < t.length && !",}] \n\r\t".includes(t.charAt(i))) i++;
  return i;
}

/** The members of the object at `from`: each key with the offset of its value, in order. */
function members(t: string, from: number): { key: string; at: number }[] {
  const out: { key: string; at: number }[] = [];
  let i = from + 1;
  while (i < t.length) {
    i = skipWs(t, i);
    const c = t.charAt(i);
    if (c === "}") break;
    if (c === ",") {
      i++;
      continue;
    }
    if (c !== '"') {
      i = Math.max(skipValue(t, i), i + 1);
      continue;
    }
    const keyEnd = skipString(t, i);
    let key = "";
    try {
      const parsed: unknown = JSON.parse(t.slice(i, keyEnd));
      key = typeof parsed === "string" ? parsed : "";
    } catch {
      // an unterminated key: the text isn't valid JSON, and the parse error is what the owner is shown
    }
    i = skipWs(t, keyEnd);
    if (t.charAt(i) === ":") i = skipWs(t, i + 1);
    out.push({ key, at: i });
    i = Math.max(skipValue(t, i), i + 1);
  }
  return out;
}

/** The offsets of the elements of the array at `from`. */
function elements(t: string, from: number): number[] {
  const out: number[] = [];
  let i = from + 1;
  while (i < t.length) {
    i = skipWs(t, i);
    const c = t.charAt(i);
    if (c === "]") break;
    if (c === ",") {
      i++;
      continue;
    }
    out.push(i);
    i = Math.max(skipValue(t, i), i + 1);
  }
  return out;
}

/**
 * The span the path names, or the nearest enclosing object or array when the path goes further than the text does.
 * A key may contain dots (`attr.str`), so a member matches when the rest of the path starts with its whole key; the
 * longest such key wins.
 */
export function locate(text: string, path: string): Located {
  let at = skipWs(text, 0);
  let rest = path === "(root)" ? "" : path;
  while (rest !== "") {
    const c = text.charAt(at);
    if (c === "[") {
      const m = /^\[(\d+)\]\.?/.exec(rest);
      const next = m ? elements(text, at)[Number(m[1])] : undefined;
      if (!m || next === undefined) return { start: at, end: at + 1, exact: false };
      at = next;
      rest = rest.slice(m[0].length);
    } else if (c === "{") {
      const hit = members(text, at)
        .filter(
          (m) => m.key !== "" && rest.startsWith(m.key) && (rest === m.key || /^[.[]/.test(rest.slice(m.key.length))),
        )
        .sort((a, b) => b.key.length - a.key.length)[0];
      if (!hit) return { start: at, end: at + 1, exact: false };
      at = hit.at;
      rest = rest.slice(hit.key.length).replace(/^\./, "");
    } else {
      return { start: at, end: at + 1, exact: false };
    }
  }
  return { start: at, end: Math.max(skipValue(text, at), at + 1), exact: true };
}
