// The importer's size cap as the api enforces it (MAX_PACK_BYTES in the rules engine). The client refuses early so a
// file that is too big isn't uploaded just to be turned away; the api's check is the one that counts.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** How many keys of a diff are listed before "and N more". */
export const DIFF_KEYS_SHOWN = 40;
