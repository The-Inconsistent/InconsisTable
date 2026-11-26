"use client";
import { useTranslations } from "next-intl";

import { Cite } from "@/components/ui/cite/cite";
import { ascensionOf, offered, pickAscension, pickPlayAscension, toggleArchetypeAscension } from "@/lib/ledger/ledger";

import { useLedger, useRowOf } from "../../ledger-context";
import { RecordList } from "../record-list/record-list";
import { StepIssues } from "../step-issues/step-issues";
import { XpCost } from "../xp-cost/xp-cost";

// ASCENSION: an Ascension Package bought at creation (an Archetype below the Tier, or Advanced Creation), and in play
// one per Tier the group ascended, or an Archetype Ascension to a higher Archetype of the same faction.
export function AscensionStep() {
  const t = useTranslations("ledgerBuilder.ascension");
  const { params, catalogue, lookups, build, play, edit } = useLedger();
  const rowOf = useRowOf();
  const { atCreation, ascending, archetypes } = ascensionOf({ build, lookups, play });
  const isAscension = (id: string) => lookups.packages.get(id)?.kind === "ascension";
  const packagesFor = (taken: string[], creation: boolean) =>
    catalogue.creation.packages
      .filter((p) => p.kind === "ascension")
      .filter((p) => offered({ params, catalogue, source: p.source, taken: taken.includes(p.id) }))
      .map((p) =>
        rowOf({
          record: p,
          requires: p.requires,
          taken: taken.includes(p.id),
          extra: [
            <XpCost key="xp" cost={p.xp} />,
            ...(creation && p.atCreationWith ? [t("onlyWith", { keyword: p.atCreationWith })] : []),
          ],
          blocked: creation && p.notAtCreation && !p.atCreationWith ? t("notAtCreation") : undefined,
        }),
      );
  const chosenArch = build.advancement?.archetypeAscension?.archetypeId;

  return (
    <div className="stack">
      <StepIssues step="ascension" />
      {atCreation && (
        <section className="stack" aria-labelledby="lb-asc-creation">
          <h3 id="lb-asc-creation" className="lb-sub">
            {t("atCreation")}
            <span className="small dim">
              {" "}
              · <Cite cite={params.cites.creationAscension} />
            </span>
          </h3>
          <RecordList
            label={t("atCreation")}
            rows={packagesFor(build.packages ?? [], true)}
            onPick={(id) => edit(pickAscension({ build, id, isAscension }))}
          />
        </section>
      )}
      {ascending && play && (
        <>
          <section className="stack" aria-labelledby="lb-asc-play">
            <h3 id="lb-asc-play" className="lb-sub">
              {t("inPlay", { from: build.tier, to: play.tier })}
              <span className="small dim">
                {" "}
                · <Cite cite={params.cites.ascensionSteps} />
              </span>
            </h3>
            {play.packageWaived && <p className="lb-banner">{t("waived")}</p>}
            <RecordList
              label={t("inPlay", { from: build.tier, to: play.tier })}
              rows={packagesFor(build.advancement?.packages ?? [], false)}
              onPick={(id) => edit(pickPlayAscension({ build, id, isAscension, play }))}
            />
          </section>
          <section className="stack" aria-labelledby="lb-asc-arch">
            <h3 id="lb-asc-arch" className="lb-sub">
              {t("archetype")}
              <span className="small dim">
                {" "}
                · <Cite cite={params.cites.archetypeAscension} />
              </span>
            </h3>
            <p className="small dim">{t("archetypeNote", { rank: params.archetypeAscension.minRank })}</p>
            <RecordList
              label={t("archetype")}
              rows={archetypes.map((a) =>
                rowOf({
                  record: a,
                  requires: a.requires,
                  taken: a.id === chosenArch,
                  extra: [t("tierN", { tier: a.tier })],
                }),
              )}
              onPick={(id) => edit(toggleArchetypeAscension({ build, archetypeId: id }))}
            />
          </section>
        </>
      )}
    </div>
  );
}
