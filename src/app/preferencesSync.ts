// Applies the stored preferences at start and saves them when they change (D38).
import { useEditorStore } from "../editor/editorStore";
import { loadPreferences, savePreferences } from "../state/preferences";
import { useViewStore } from "../state/viewStore";

let started = false;

export function startPreferenceSync(): void {
  if (started) return;
  started = true;
  const p = loadPreferences();
  useEditorStore.setState({ props: p.toolProps });
  useViewStore.setState({
    thumbnailsOpen: p.thumbnailsOpen,
    zoomMode: p.zoomMode,
    ...(p.zoomMode === "custom" ? { scale: p.scale } : {}),
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer);
    // Zooming changes the scale often; write once it settles.
    timer = setTimeout(() => {
      const e = useEditorStore.getState();
      const v = useViewStore.getState();
      savePreferences({ toolProps: e.props, thumbnailsOpen: v.thumbnailsOpen, zoomMode: v.zoomMode, scale: v.scale });
    }, 300);
  };
  useEditorStore.subscribe((s, prev) => {
    if (s.props !== prev.props) save();
  });
  useViewStore.subscribe((s, prev) => {
    if (s.thumbnailsOpen !== prev.thumbnailsOpen || s.zoomMode !== prev.zoomMode || (s.zoomMode === "custom" && s.scale !== prev.scale)) save();
  });
}
