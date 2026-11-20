import type { Pack, PackEntry } from "./pack.ts";

// Hashing is in plain TypeScript, not node:crypto, because this package is bundled into the web app as well.

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** SHA-256 of UTF-8 text, as lowercase hex. */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64).fill(0);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15] ?? 0;
      const b = w[i - 2] ?? 0;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] ?? 0) + (w[i] ?? 0)) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = ((h[i] ?? 0) + v) | 0));
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

/** JSON with object keys sorted at every depth and `undefined` dropped, so equal content is equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const parts = Object.keys(value)
      .sort()
      .flatMap((k) => {
        const v = (value as Record<string, unknown>)[k];
        return v === undefined ? [] : [`${JSON.stringify(k)}:${canonicalJson(v)}`];
      });
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Hash of what an entry says: stable under key order and under the order of its tags, so a re-import of the same
 * content hashes the same. Takes a parsed entry (defaults applied), so an omitted default and a written one agree.
 */
export function contentHash(entry: PackEntry): string {
  // An entry with no effects hashes as before effects existed, so a stored hash stays valid.
  const { effects, ...rest } = entry;
  return sha256Hex(
    canonicalJson({ ...rest, ...(effects.length > 0 ? { effects } : {}), tags: [...entry.tags].sort() }),
  );
}

export interface PackDiff {
  /** Keys, sorted. */
  added: string[];
  changed: string[];
  removed: string[];
}

/** Diff two `key → content hash` maps; the importer holds these in `pack_entry` without loading bodies. */
export function diffHashes({
  prev,
  next,
}: {
  prev: ReadonlyMap<string, string>;
  next: ReadonlyMap<string, string>;
}): PackDiff {
  const added = [...next.keys()].filter((k) => !prev.has(k));
  const removed = [...prev.keys()].filter((k) => !next.has(k));
  const changed = [...next].filter(([k, hash]) => prev.has(k) && prev.get(k) !== hash).map(([k]) => k);
  const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return { added: added.sort(byCode), changed: changed.sort(byCode), removed: removed.sort(byCode) };
}

function hashes(pack: Pick<Pack, "entries"> | null): Map<string, string> {
  return new Map((pack?.entries ?? []).map((e) => [e.key, contentHash(e)]));
}

/** What an import changes against the previous version (`null`: the first import, everything is added). */
export function diffPack({
  prev,
  next,
}: {
  prev: Pick<Pack, "entries"> | null;
  next: Pick<Pack, "entries">;
}): PackDiff {
  return diffHashes({ prev: hashes(prev), next: hashes(next) });
}
