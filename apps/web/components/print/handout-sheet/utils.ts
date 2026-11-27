import { pictureUrl } from "@/lib/entry-picture/entry-picture";
import type { HandoutPage } from "@/lib/print/cards";

const MAX_PX = 1200; // sharp on a 70 mm tall picture, and the PDF stays small

// react-pdf embeds PNG and JPEG only, and pictures are stored as WebP: redraw one onto a canvas as a PNG data URL.
// The picture comes from the api's seat-gated route, which this browser already reads; nothing goes up.
async function png(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const scale = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** Each handout's picture this seat was sent, as a PNG; one that fails to load is left off its page. */
export async function picturesOf({
  campaignId,
  pages,
}: {
  campaignId: string;
  pages: readonly HandoutPage[];
}): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of pages) {
    if (!p.imageId) continue;
    try {
      out.set(p.id, await png(pictureUrl({ campaignId, imageId: p.imageId })));
    } catch {
      // left off: the handout still prints
    }
  }
  return out;
}
