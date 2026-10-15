"use client";
import { OrderView } from "@/components/ui/order-view/order-view";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { useTable } from "@/hooks/use-table/use-table";

type TableScreenProps = { campaignId: string };

// The TV at the table (docs/design.md §1.1): read from across the room, no input. It joins by a screen token and sees
// the party view; turn order, party bars and the revealed map join it with the first ruleset (P1) and maps (P2).
export function TableScreen({ campaignId }: TableScreenProps) {
  const { state, codex, online } = useTable(campaignId);
  if (!state) return <StatusScreen text="Syncing…" />;
  const revealed = (codex?.entries ?? []).filter((e) => e.audienceMode === "all");
  return (
    <div className="surface-table" data-density="tv">
      <main className="screen stack">
        {/* The screen has no header band: the badge is its first row instead. */}
        {!online && (
          <span className="badge-offline" role="status">
            NO SIGNAL
          </span>
        )}
        <h1 className="title">{state.campaign.name}</h1>
        <p>{state.session ? `Session ${state.session.number}` : "Between sessions"}</p>
        <p className="dim">
          {state.actors
            .filter((a) => a.kind === "pc")
            .map((a) => a.name)
            .join(" · ")}
        </p>
        {state.encounter && <OrderView encounter={state.encounter} />}
        {/* A Test in progress: that it is, and how far along. Never who, or any number (the state carries none). */}
        {state.tests
          .filter((c) => c.status === "open")
          .map((c) => (
            <section key={c.id} className="card" role="status">
              <strong>Test in progress</strong>
              <span>
                {c.testId}: {c.reported} of {c.called} have rolled
              </span>
            </section>
          ))}
        {revealed.map((e) => (
          <section key={e.id} className="card">
            <strong>{e.title}</strong>
            <span>{e.body}</span>
          </section>
        ))}
      </main>
    </div>
  );
}
