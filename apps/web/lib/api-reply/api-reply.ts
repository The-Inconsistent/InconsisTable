import { z } from "zod";

// The api's replies that carry a seat's table (create room, accept invite, guest join, /api/guest). The id goes into a
// URL path, so only id characters pass.
export const CampaignRef = z.object({ campaignId: z.string().regex(/^[A-Za-z0-9-]+$/) });

// The api's refusal body; any other shape falls back to the caller's own text.
export const ApiMessage = z.object({ message: z.string() });

// A fetch body as untrusted JSON, or null when it isn't JSON.
export async function readJson(res: Response): Promise<unknown> {
  try {
    const body: unknown = await res.json();
    return body;
  } catch {
    return null;
  }
}
