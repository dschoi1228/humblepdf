// Opening the find bar (M14, D49), shared by Ctrl+F, F3 and the toolbar button.
import { useSearchStore } from "../search/searchStore";
import { hasTextSelection, selectedText } from "../viewer/textLayer";

/** Selected page text on one line becomes the query; otherwise the last query stays. */
export function openFind(): void {
  const text = hasTextSelection() ? selectedText().trim() : "";
  useSearchStore.getState().openBar(text && !/[\r\n]/.test(text) ? text : undefined);
}
