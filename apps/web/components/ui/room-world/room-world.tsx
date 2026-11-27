import { getLocale } from "next-intl/server";

import type { Ruleset } from "@inconsistable/rules-engine";

import { RoomHandouts } from "@/components/ui/room-handouts/room-handouts";
import { roomMessages } from "@/lib/terms/room-messages";
import { roomLook, type RoomWorld as RoomWorldData } from "@/lib/world/room";

import { RoomMessages } from "./components/room-messages/room-messages";

type RoomWorldProps = { world: RoomWorldData; ruleset?: Ruleset | null; children: React.ReactNode };

// A room page wearing its World (docs/adr/0010, decision 2): the wrapper's attributes and the World's colours are in
// the server's response, so the first paint is the World's. Without a World the element is bare, and the device's
// lantern or felt shows. The element itself stays either way, so a World pinned mid-session does not remount the table
// (its socket and open tab) under it. The room's words (issue #159) are the messages it words differently from the
// app: the World's, then the ruleset's, then the app's own, in the viewer's language, laid over the page's messages.
export async function RoomWorld({ world, ruleset = null, children }: RoomWorldProps) {
  const look = roomLook(world);
  const changes = await roomMessages({ world, ruleset, locale: await getLocale() });
  return (
    <div {...look?.attributes}>
      {look && <style>{look.style}</style>}
      <RoomMessages changes={changes}>
        <RoomHandouts handouts={world?.handouts ?? null}>{children}</RoomHandouts>
      </RoomMessages>
    </div>
  );
}
