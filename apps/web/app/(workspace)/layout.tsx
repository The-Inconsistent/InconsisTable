import { readLobby } from "@/app/server-api";
import { WorkspaceShell } from "@/components/workspace/workspace-shell/workspace-shell";

type WorkspaceLayoutProps = { children: React.ReactNode };

// The device user's workspace (docs/design.md §3.2): rooms, characters, rulesets and packs behind one left rail. The
// rail's name and counts come from the lobby, read once per request with the page under it.
export default async function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const lobby = await readLobby();
  return <WorkspaceShell lobby={lobby}>{children}</WorkspaceShell>;
}
