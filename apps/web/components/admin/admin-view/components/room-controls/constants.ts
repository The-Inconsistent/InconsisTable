// The room card's steps that ask a second tap before they go (house decision #94).
export const ROOM_CONFIRMS = ["abandon", "deleteSession"] as const;
export type RoomConfirm = (typeof ROOM_CONFIRMS)[number];
