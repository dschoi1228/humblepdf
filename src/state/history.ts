// Undo history of document snapshots (SPEC 6.3, 6.4; D25). Model changes are pure
// functions, so unchanged pages are shared between snapshots.

export const HISTORY_LIMIT = 100;

export type History<T> = { past: T[]; present: T; future: T[] };

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Records a change. The same value is not recorded; a new change clears the redo list. */
export function record<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
