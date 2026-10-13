import type { Problem } from "@/lib/library/library";

export type Located = Problem & { at?: number };

type ProblemListProps = {
  title: string;
  items: Located[];
  tone: "error" | "warn";
  onPick: (item: Located) => void;
};

// What the importer found, one tappable row per path: tapping selects that spot in the pasted text.
export function ProblemList({ title, items, tone, onPick }: ProblemListProps) {
  if (items.length === 0) return null;
  return (
    <section className="stack" aria-label={title}>
      <h3 className="problems-title" data-tone={tone}>
        {title} ({items.length})
      </h3>
      <ul className="problems">
        {items.map((item, i) => (
          <li key={`${item.path}-${i}`}>
            <button type="button" className="problem" data-tone={tone} onClick={() => onPick(item)}>
              <code className="problem-path">{item.path}</code>
              <span>{item.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
