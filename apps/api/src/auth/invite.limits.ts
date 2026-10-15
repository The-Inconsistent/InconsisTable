// A room invite's QR lets anyone make a new character on every accept, and each one grows the broadcast snapshot.
// ponytail: `invite.uses` counts every accept of the invite (picking an open character too), so the per-invite cap is
// slightly stricter than "characters it made"; a created-by-invite column if that ever bites. The per-campaign cap
// counts every pc, whoever made it. Flat numbers for a table of a handful; make them per-room settings if one outgrows them.
export const MAX_NEW_CHARACTERS_PER_INVITE = 50;
export const MAX_NEW_CHARACTERS_PER_CAMPAIGN = 50;
