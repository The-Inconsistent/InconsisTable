"use client";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";

import { canInCampaign, type ActionInput, type Me } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import type { RulesTabData } from "@/lib/library/library";

type RulesPanelProps = { me: Me; send: Send; data: RulesTabData | null };

// RULES: the ruleset this room plays and the packs attached to it. The owner pins a ruleset they imported and attaches
// or detaches their packs; a refusal (characters already use another version, a private pack in the wrong room) shows
// under the thing that was tapped. Everything imported lives in the library (/library).
export function RulesPanel({ me, send, data }: RulesPanelProps) {
  const router = useRouter();
  const canEdit = canInCampaign({ ctx: me, perm: "campaign:ruleset" });
  const versions = (data?.rulesets ?? []).flatMap((r) =>
    r.versions.map((v) => ({ id: v.id, label: `${r.slug} ${v.version}` })),
  );
  const [pick, setPick] = useState(data?.pinned?.versionId ?? versions[0]?.id ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sends one pin/attach/detach and shows its refusal under `key`, or refreshes the page's data.
  const act = async ({ key, action }: { key: string; action: ActionInput }) => {
    setBusy(key);
    const r = await send(action);
    setBusy(null);
    setErrors(({ [key]: _old, ...rest }) => (r.ok ? rest : { ...rest, [key]: r.error }));
    if (r.ok) router.refresh();
  };

  // RULESET picker: the version to pin.
  const handlePick = (e: ChangeEvent<HTMLSelectElement>) => setPick(e.target.value);

  if (!data) return <p className="error">Couldn&apos;t read the rules. Check the connection and reload.</p>;
  const { pinned, attached } = data;
  const mine = pinned ? data.packs.packs.filter((p) => p.rulesetSlug === pinned.slug) : [];

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 640 }}>
      <section className="stack">
        <h2 className="head">Ruleset</h2>
        {pinned ? (
          <p>
            <strong>{pinned.slug}</strong> <span className="chip">{pinned.version}</span>
          </p>
        ) : (
          <p className="dim">No ruleset yet. Pin one to build characters and call Tests.</p>
        )}
        {canEdit &&
          (versions.length === 0 ? (
            <p className="dim">
              You haven&apos;t imported a ruleset. <a href="/library">Import one</a> first.
            </p>
          ) : (
            <div className="row" style={{ alignItems: "end" }}>
              <label>
                My rulesets
                <select id="rules-pick" value={pick} onChange={handlePick}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn primary"
                disabled={busy === "pin" || pick === pinned?.versionId}
                onClick={() => act({ key: "pin", action: { type: "campaign.setRuleset", rulesetVersionId: pick } })}
              >
                {pinned ? "Switch to this" : "Pin this ruleset"}
              </button>
            </div>
          ))}
        {errors.pin && (
          <p className="error" role="alert">
            {errors.pin}
          </p>
        )}
      </section>

      <section className="stack">
        <h2 className="head">Packs</h2>
        {!pinned && <p className="dim">Pin a ruleset first: a pack is written for one.</p>}
        {pinned && !canEdit && (
          <ul className="list">
            {attached.map((p) => (
              <li key={p.id}>
                <strong>{p.slug}</strong> <span className="chip">{p.version}</span>
              </li>
            ))}
            {attached.length === 0 && <li className="dim">No pack is attached.</li>}
          </ul>
        )}
        {pinned && canEdit && mine.length === 0 && (
          <p className="dim">
            You have no pack for {pinned.slug}. <a href="/library">Import one</a>.
          </p>
        )}
        {pinned && canEdit && (
          <ul className="stack library-list">
            {mine.map((p) => {
              const latest = p.versions[0];
              const on = attached.find((a) => a.slug === p.slug);
              const outdated = on !== undefined && latest !== undefined && on.id !== latest.id;
              return (
                <li key={p.id} className="card">
                  <div className="row between">
                    <strong>{p.slug}</strong>
                    <span className="row">
                      <span className="chip">{p.license}</span>
                      {on && <span className="chip">Attached {on.version}</span>}
                    </span>
                  </div>
                  {latest && (
                    <p className="small dim">
                      Latest {latest.version}, {latest.entryCount} entries
                    </p>
                  )}
                  {p.disabled && <p className="error">Taken down by an admin.</p>}
                  <div className="row">
                    {latest && (!on || outdated) && (
                      <button
                        className="btn primary"
                        disabled={busy === p.id || p.disabled}
                        aria-label={`${outdated ? "Update" : "Attach"} ${p.slug}`}
                        onClick={() =>
                          act({ key: p.id, action: { type: "campaign.attachPack", packVersionId: latest.id } })
                        }
                      >
                        {outdated ? `Update to ${latest.version}` : "Attach"}
                      </button>
                    )}
                    {on && (
                      <button
                        className="btn"
                        disabled={busy === p.id}
                        aria-label={`Detach ${p.slug}`}
                        onClick={() =>
                          act({ key: p.id, action: { type: "campaign.detachPack", packVersionId: on.id } })
                        }
                      >
                        Detach
                      </button>
                    )}
                  </div>
                  {errors[p.id] && (
                    <p className="error" role="alert">
                      {errors[p.id]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && (
          <p className="small">
            <a href="/library">Rulesets &amp; packs</a>: import, export or delete.
          </p>
        )}
      </section>
    </div>
  );
}
