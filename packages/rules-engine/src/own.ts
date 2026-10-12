/**
 * Read a key only if the record itself holds it. Ids come from user-written manifests, and `constructor` or
 * `toString` pass the id pattern: a plain `rec[key]` would hand back an Object.prototype member.
 */
export function own<T>(rec: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}
