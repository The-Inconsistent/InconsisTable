type StatusScreenProps = { text: string };

// A full-screen line for the moments with nothing else to show: no access, no signal, syncing.
export function StatusScreen({ text }: StatusScreenProps) {
  return (
    <main className="center">
      <p className="status" role="status">
        {text}
      </p>
    </main>
  );
}
