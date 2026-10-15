import { z } from "zod";

import type { Refused } from "./actions.ts";
import { RefusalKey, RefusalParamsSchema } from "./refusals.ts";

// Book pages reach seated players only live (CLAUDE.md, "Books never reach the server"). The GM's tablet holds the
// PDFs, picked on that device; when a player taps a cite, that tablet renders the one page and the api relays the image
// to that player only. Nothing is uploaded or stored. A source is a ruleset's `sources[].id`; turning a printed page
// into a PDF page (the source's `pageOffset`) happens on the GM's tablet, which holds the manifest.

export const BookSource = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
export type BookSource = z.infer<typeof BookSource>;

export const BookPage = z.object({ source: BookSource, page: z.number().int().min(1).max(5000) });
export type BookPage = z.infer<typeof BookPage>;

// Socket events (table.gateway.ts). A GM socket says which sources it serves; every seat hears the union.
export const MAX_SERVED_SOURCES = 100;
export const BookServing = z.object({ sources: z.array(BookSource).max(MAX_SERVED_SOURCES) });
export type BookServing = z.infer<typeof BookServing>;
export type BookAvailable = { sources: BookSource[] };

// A JPEG of one page, about 150–400 KB at the width the GM renders.
export const MAX_PAGE_BYTES = 1_500_000;
export type BookReply = { ok: true; image: ArrayBuffer } | Refused;
// The GM tablet's ack as the api receives it: socket.io hands binary over as a Node Buffer, which is a Uint8Array
// (checked as that, so this module still loads in the browser). Untrusted until parsed, like any socket payload.
export const BookAck = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    image: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_PAGE_BYTES, "page size"),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().transform((e) => e.slice(0, 200)),
    // A code this api does not know (an older tablet build) is dropped, and the text stays.
    code: RefusalKey.optional().catch(undefined),
    params: RefusalParamsSchema.optional().catch(undefined),
  }),
]);
export type BookAck = z.infer<typeof BookAck>;
