import { ViewTransition } from "react";

type WorkspaceTemplateProps = { children: React.ReactNode };

// A template remounts on every workspace page change while the layout (the rail) stays, so the old page leaves and the
// new one arrives (globals.css, Page change). Refreshes keep the template mounted and do not move.
export default function WorkspaceTemplate({ children }: WorkspaceTemplateProps) {
  return (
    <ViewTransition enter="arrive" exit="leave" default="none">
      {children}
    </ViewTransition>
  );
}
