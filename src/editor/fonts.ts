// The bundled text fonts on screen (D32): the same files the core embeds, registered as
// web fonts so SVG text and the text editor use them. CSS fallback picks each character
// from the first family that has it, the same rule as the core's FontSet.
import jpUrl from "../../assets/fonts/PretendardJP-Common.ttf?url";
import mainUrl from "../../assets/fonts/Pretendard-Regular.ttf?url";

export const TEXT_FONT = "HumblePDFText";
export const TEXT_FONT_JP = "HumblePDFTextJP";
/** `font-family` value for text objects. */
export const TEXT_FONT_FAMILY = `${TEXT_FONT}, ${TEXT_FONT_JP}`;
export const TEXT_FONT_URLS = { main: mainUrl, jp: jpUrl };

let loaded: Promise<void> | null = null;

/** Registers and loads both fonts once; resolves when they can be measured. */
export function loadTextFonts(): Promise<void> {
  loaded ??= (async () => {
    const faces = [new FontFace(TEXT_FONT, `url(${mainUrl})`), new FontFace(TEXT_FONT_JP, `url(${jpUrl})`)];
    for (const f of faces) document.fonts.add(f);
    await Promise.all(faces.map((f) => f.load()));
  })();
  return loaded;
}
