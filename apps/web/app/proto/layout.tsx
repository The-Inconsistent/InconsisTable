import { Switcher } from "./switcher";

import "./proto.css";

// PROTOTYPE (branch prototype/theme, never merged): theme variants over the real components, fake data, no api.
export default function ProtoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Switcher />
    </>
  );
}
