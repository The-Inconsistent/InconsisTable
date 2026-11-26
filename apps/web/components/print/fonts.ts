import { Font } from "@react-pdf/renderer";

// The one face every printed page uses: Be Vietnam Pro, the app's own body face, which covers Vietnamese (the PDF's
// built-in faces don't). Static TTFs under public/fonts (SIL OFL, licence beside them): react-pdf can't use the
// subset, variable files next/font serves. Fetched from this app's own origin, so a build sends nothing anywhere else.
export const FACE = "Be Vietnam Pro";

let ready = false; // react-pdf keeps registered fonts for the page's life

/** Registers the face before the first build; `base` is the page's origin. */
export function registerFontsOnce(base: string) {
  if (ready) return;
  Font.register({
    family: FACE,
    fonts: [
      { src: `${base}/fonts/BeVietnamPro-Regular.ttf` },
      { src: `${base}/fonts/BeVietnamPro-Bold.ttf`, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]); // names and rules terms stay whole
  ready = true;
}
