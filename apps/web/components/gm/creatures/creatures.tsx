"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Ruleset } from "@inconsistable/rules-engine";

import { useRefusal, type RefusalText } from "@/hooks/use-refusal/use-refusal";
import type { Send } from "@/hooks/use-table/use-table";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { clampCount, creatureTypes, MAX_SPAWN, MIN_SPAWN } from "@/lib/creatures/creatures";
import { RulesReply, type RulesEntry } from "@/lib/library/library";

type CreaturesProps = { campaignId: string; send: Send };

const PAGE = 50;

// One read of the seat-scoped rules route, parsed. Throws the api's own words when it refuses.
async function readRules({
  path,
  fallback,
  tr,
}: {
  path: string;
  fallback: string;
  tr: (r: RefusalText) => string;
}): Promise<RulesReply> {
  const res = await fetch(path);
  const body = await readJson(res);
  const parsed = RulesReply.safeParse(body);
  if (res.ok && parsed.success) return parsed.data;
  const refusal = ApiMessage.safeParse(body);
  throw new Error(refusal.success ? tr(refusal.data) : fallback);
}

// ADD CREATURES: search the attached packs for creatures by name, pick one, say how many, and place them. They arrive
// numbered ("Goblin 1", "Goblin 2"…) with the entry's values; a temporary one goes when the encounter ends.
export function Creatures({ campaignId, send }: CreaturesProps) {
  const t = useTranslations("creatures");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const readFailed = t("readFailed");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ entries: RulesEntry[]; versions: Map<string, string> } | null>(null);
  const [picked, setPicked] = useState<RulesEntry | null>(null);
  const [count, setCount] = useState(3);
  const [temporary, setTemporary] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // SEARCH: reads the ruleset once for its creature types, then each type's entries matching the name.
  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const base = `/api/campaigns/${encodeURIComponent(campaignId)}/rules`;
      const room = await readRules({ path: `${base}?limit=1`, fallback: readFailed, tr });
      const ruleset = Ruleset.safeParse(room.ruleset?.manifest);
      if (!ruleset.success) throw new Error(t("pickRuleset"));
      const name = q.trim() === "" ? "" : `&q=${encodeURIComponent(q.trim())}`;
      const replies = await Promise.all(
        creatureTypes(ruleset.data).map((type) =>
          readRules({
            path: `${base}?type=${encodeURIComponent(type)}${name}&limit=${PAGE}`,
            fallback: readFailed,
            tr,
          }),
        ),
      );
      const versions = new Map(replies.flatMap((r) => r.packs.map((p) => [p.slug, p.id] as const)));
      setFound({ entries: replies.flatMap((r) => r.entries), versions });
      setPicked(null);
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : tStatus("nosignal"),
        ok: false,
      });
    }
    setBusy(false);
  };

  // SPAWN: places the creatures; the server numbers them and writes their values.
  const handleSpawn = async () => {
    const packVersionId = picked && found?.versions.get(picked.pack);
    if (!picked || !packVersionId) return;
    setBusy(true);
    const r = await send({ type: "actor.spawn", packVersionId, key: picked.key, count, temporary });
    setBusy(false);
    setMessage(r.ok ? { text: t("added", { count, name: picked.name }), ok: true } : { text: r.error, ok: false });
  };

  return (
    <section className="stack">
      <h2 className="head">{t("title")}</h2>
      <form className="row" onSubmit={handleSearch}>
        <input
          id="creature-search"
          aria-label={t("searchLabel")}
          placeholder={t("searchLabel")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          style={{ flex: 1 }}
        />
        <button className="btn" disabled={busy}>
          {t("search")}
        </button>
      </form>
      {found && found.entries.length === 0 && <p className="dim">{t("noMatch")}</p>}
      {found && found.entries.length > 0 && (
        <div className="stack" role="group" aria-label={t("found")}>
          {found.entries.map((e) => (
            <button
              key={`${e.pack}/${e.key}`}
              type="button"
              className="found"
              aria-pressed={picked === e}
              onClick={() => setPicked(e)}
            >
              <strong>{e.name}</strong>
              <span className="row small dim">
                {e.level !== null && <span className="chip">{t("level", { level: e.level })}</span>}
                {e.tags.join(", ")}
              </span>
            </button>
          ))}
        </div>
      )}
      {picked && (
        <div className="card">
          <strong>{picked.name}</strong>
          <div className="row">
            <span className="stepper">
              <button
                type="button"
                className="btn"
                aria-label={t("fewer")}
                disabled={count <= MIN_SPAWN}
                onClick={() => setCount(clampCount(count - 1))}
              >
                −
              </button>
              <output aria-label={t("howMany")}>{count}</output>
              <button
                type="button"
                className="btn"
                aria-label={t("more")}
                disabled={count >= MAX_SPAWN}
                onClick={() => setCount(clampCount(count + 1))}
              >
                +
              </button>
            </span>
            <label className="row" style={{ minHeight: 44 }}>
              <input
                type="checkbox"
                checked={temporary}
                onChange={(e) => setTemporary(e.target.checked)}
                style={{ minHeight: 24 }}
              />
              {t("temporary")}
            </label>
          </div>
          <button className="btn primary" disabled={busy} onClick={handleSpawn} style={{ justifySelf: "start" }}>
            {t("spawn", { count, name: picked.name })}
          </button>
        </div>
      )}
      {message && (
        <p className={message.ok ? "small" : "error"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
