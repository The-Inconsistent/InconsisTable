type PageHeadProps = { title: string; lede: string; children?: React.ReactNode };

// A workspace page's head: its name, one line on what it holds, and its main action on the right.
export function PageHead({ title, lede, children }: PageHeadProps) {
  return (
    <header className="ws-head">
      <div>
        <h1 className="title">{title}</h1>
        <p className="dim">{lede}</p>
      </div>
      {children}
    </header>
  );
}
