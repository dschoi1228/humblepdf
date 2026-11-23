// Copy and paste of page objects within the app (SPEC 6.4, D35). Pure functions: the copied
// object keeps the page it came from, and pasting places a copy on a target page.
import type { Page } from "../bindings/Page";
import type { PageObject } from "../bindings/PageObject";
import type { Rotation } from "../bindings/Rotation";
import { deltaToUser, displayRotation, viewportTransform } from "../coords";
import { keepInside, moveObject } from "./geometry";

/** Offset of a paste onto the page it was copied from, right and down on screen (pt). */
export const PASTE_OFFSET = 10;

export type Copied = {
  object: PageObject;
  /** Page the object was copied from, and its display rotation then. */
  pageId: string;
  rotation: Rotation;
  box: Page["box"];
};

export function copyOf(page: Page, object: PageObject): Copied {
  return {
    object: structuredClone(object),
    pageId: page.id,
    rotation: displayRotation(page.baseRotation, page.userRotation),
    box: page.box,
  };
}

const turn = (r: Rotation, by: number) => ((((r + by) % 360) + 360) % 360) as Rotation;

/**
 * The copy to add to `target` as the `n`-th paste (1, 2, ...). On the source page each paste
 * moves PASTE_OFFSET further right and down on screen; on another page the object keeps its
 * place relative to the page box. Text and signatures turn with the difference in display
 * rotation so they look the same on screen. The result stays inside the page.
 */
export function pasted(copied: Copied, target: Page, n: number, id: string): PageObject {
  let o: PageObject = { ...structuredClone(copied.object), id };
  const targetRotation = displayRotation(target.baseRotation, target.userRotation);
  if (target.id === copied.pageId) {
    const t = viewportTransform(target.box, targetRotation, 1);
    const d = deltaToUser(t, PASTE_OFFSET * n, PASTE_OFFSET * n);
    // Move freely first, then pull back inside: a paste near an edge still lands on the page.
    o = moveObject(o, d.x, d.y, { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity });
  } else {
    const dx = target.box.x0 - copied.box.x0;
    const dy = target.box.y0 - copied.box.y0;
    o = moveObject(o, dx, dy, { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity });
    const by = targetRotation - copied.rotation;
    if (by % 360 !== 0) {
      if (o.type === "text") o = { ...o, rotation: turn(o.rotation, by) };
      if (o.type === "signature") {
        // The rect is the box after rotation: a quarter turn swaps its sides.
        const r = o.rect;
        const quarter = Math.abs(by) % 180 === 90;
        const cx = (r.x0 + r.x1) / 2;
        const cy = (r.y0 + r.y1) / 2;
        const hw = (quarter ? r.y1 - r.y0 : r.x1 - r.x0) / 2;
        const hh = (quarter ? r.x1 - r.x0 : r.y1 - r.y0) / 2;
        o = { ...o, rotation: turn(o.rotation, by), rect: { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh } };
      }
    }
  }
  return keepInside(o, target.box);
}
