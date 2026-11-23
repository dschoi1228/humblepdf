// The bundled text fonts on screen (D32, D39): the same bytes the core embeds, received from
// the backend and registered as web fonts so SVG text and the text editor use them. CSS
// fallback picks each character from the first family that has it, the same rule as the
// core's FontSet.
import { backend } from "../backend";

export const TEXT_FONT = "HumblePDFText";
export const TEXT_FONT_JP = "HumblePDFTextJP";
/** `font-family` value for text objects. */
export const TEXT_FONT_FAMILY = `${TEXT_FONT}, ${TEXT_FONT_JP}`;

let loaded: Promise<void> | null = null;

/** Registers and loads both fonts once; resolves when they can be measured. */
export function loadTextFonts(): Promise<void> {
  loaded ??= (async () => {
    const [main, jp] = await Promise.all([backend.fontBytes("main"), backend.fontBytes("jp")]);
    const faces = [new FontFace(TEXT_FONT, main as BufferSource), new FontFace(TEXT_FONT_JP, jp as BufferSource)];
    for (const f of faces) document.fonts.add(f);
    await Promise.all(faces.map((f) => f.load()));
  })();
  return loaded;
}
