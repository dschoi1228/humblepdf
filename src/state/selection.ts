// Page selection rules for the thumbnail panel (SPEC 6.3). Pure functions; the document
// store keeps the state. Selection is not part of the Undo history.

export type Selection = {
  ids: ReadonlySet<string>;
  /** Start of a Shift range. */
  anchor: string | null;
};

export const emptySelection: Selection = { ids: new Set(), anchor: null };

/**
 * Click on a page: plain click selects only that page, Ctrl toggles it, Shift selects the
 * range from the anchor (Ctrl+Shift adds the range to the selection).
 */
export function clickSelect(
  sel: Selection,
  order: readonly string[],
  id: string,
  mods: { ctrl: boolean; shift: boolean },
): Selection {
  if (mods.shift && sel.anchor !== null) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [from, to] = a <= b ? [a, b] : [b, a];
      const ids = new Set(mods.ctrl ? sel.ids : []);
      for (let i = from; i <= to; i++) ids.add(order[i]);
      return { ids, anchor: sel.anchor };
    }
  }
  if (mods.ctrl) {
    const ids = new Set(sel.ids);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    return { ids, anchor: id };
  }
  return { ids: new Set([id]), anchor: id };
}

export function selectAll(order: readonly string[]): Selection {
  return { ids: new Set(order), anchor: order[0] ?? null };
}

/** Drops ids that are no longer in the document. Returns the same object when unchanged. */
export function pruneSelection(sel: Selection, order: readonly string[]): Selection {
  const present = new Set(order);
  let changed = false;
  const ids = new Set<string>();
  for (const id of sel.ids) {
    if (present.has(id)) ids.add(id);
    else changed = true;
  }
  const anchor = sel.anchor !== null && present.has(sel.anchor) ? sel.anchor : null;
  if (!changed && anchor === sel.anchor) return sel;
  return { ids, anchor };
}
