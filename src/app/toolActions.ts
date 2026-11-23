// Tool selection from the edit bar and the keyboard (SPEC 6.4, D31).
import { useEditorStore } from "../editor/editorStore";
import type { Tool } from "../editor/tools";
import { useSignatureStore } from "../signatures/signatureStore";

/**
 * Picks a tool. The signature tool opens the signature library when it is empty, since
 * there is nothing to place yet (D31).
 */
export function chooseTool(tool: Tool): void {
  useEditorStore.getState().setTool(tool);
  if (tool !== "signature") return;
  const lib = useSignatureStore.getState();
  if (lib.loaded && lib.list.length === 0) lib.openDialog();
}
