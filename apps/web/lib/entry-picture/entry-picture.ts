import { TOKENS } from "@/lib/tokens/tokens";

/** The long side a picture is shrunk to on the device, and the encoder's quality (Auspex's numbers). */
export const PICTURE_LONG_SIDE = 1024;
export const PICTURE_QUALITY = 0.85;

/** Where a seat fetches an entry's picture; the api answers only a seat that may see it. */
export function pictureUrl({ campaignId, imageId }: { campaignId: string; imageId: string }): string {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/images/${encodeURIComponent(imageId)}`;
}

/** Where a character's picture is uploaded: its holder's seat or the GM side only (house decision #155). */
export function actorPictureUploadUrl({ campaignId, actorId }: { campaignId: string; actorId: string }): string {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/actors/${encodeURIComponent(actorId)}/images`;
}

// The size a picture is drawn at: its long side at most `longSide`, never enlarged, never under 1px.
export function fitWithin({
  width,
  height,
  longSide = PICTURE_LONG_SIDE,
}: {
  width: number;
  height: number;
  longSide?: number;
}) {
  const scale = Math.min(1, longSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const encode = async ({ canvas, type }: { canvas: HTMLCanvasElement; type: string }) => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PICTURE_QUALITY));
  return blob;
};

// Shrinks a picked file on the device and re-encodes it as WebP; a browser that can't encode WebP (it hands back PNG)
// gets JPEG, painted on the page colour since JPEG has no transparency. Throws when the file isn't a picture.
export async function shrinkPicture(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  Object.assign(canvas, fitWithin({ width: bitmap.width, height: bitmap.height }));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const webp = await encode({ canvas, type: "image/webp" });
  if (webp?.type === "image/webp") return webp;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = TOKENS.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jpeg = await encode({ canvas, type: "image/jpeg" });
  if (!jpeg) throw new Error("no encoder");
  return jpeg;
}
