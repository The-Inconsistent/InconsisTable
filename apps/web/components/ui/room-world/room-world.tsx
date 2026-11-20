import { roomLook, type RoomWorld as RoomWorldData } from "@/lib/world/room";

type RoomWorldProps = { world: RoomWorldData; children: React.ReactNode };

// A room page wearing its World (docs/adr/0010, decision 2): the wrapper's attributes and the World's colours are in
// the server's response, so the first paint is the World's. Without a World the element is bare, and the device's
// lantern or felt shows. The element itself stays either way, so a World pinned mid-session does not remount the table
// (its socket and open tab) under it.
export function RoomWorld({ world, children }: RoomWorldProps) {
  const look = roomLook(world);
  return (
    <div {...look?.attributes}>
      {look && <style>{look.style}</style>}
      {children}
    </div>
  );
}
