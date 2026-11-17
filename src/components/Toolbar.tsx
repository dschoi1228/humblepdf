import {
  File,
  FilePlus2,
  Image,
  Languages,
  MoveHorizontal,
  PanelLeft,
  Redo2,
  RectangleVertical,
  RotateCcw,
  RotateCw,
  Save,
  SaveAll,
  Scan,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState } from "react";
import { pickAndAddFiles } from "../app/actions";
import { deleteTargets, rotateTargets, setFitOfTargets } from "../app/pageActions";
import { newDocument, save, saveAs } from "../app/save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDocumentStore } from "../state/documentStore";
import { Divider, IconButton } from "./IconButton";
import { useViewStore } from "../state/viewStore";
import { LOCALE_NAMES, LOCALES, useLocaleStore, useStrings, type Locale } from "../i18n";
import { MAX_SCALE, MIN_SCALE } from "../viewer/layout";

function PageNumberInput() {
  const t = useStrings();
  const total = useDocumentStore((s) => s.doc.pages.length);
  const current = useViewStore((s) => s.currentPage);
  // Text being typed; null shows the current page.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(current + 1);

  const commit = () => {
    if (draft === null) return;
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n) && total > 0) useViewStore.getState().goToPage(Math.min(Math.max(n, 1), total) - 1);
    setDraft(null);
  };

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Input
        aria-label={t.toolbar.pageNumber}
        className="h-8 w-14 text-center"
        inputMode="numeric"
        value={total ? text : ""}
        disabled={!total}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        onBlur={commit}
        data-testid="page-input"
      />
      <span className="text-neutral-600 tabular-nums" data-testid="page-total">
        {t.toolbar.pageOf(total)}
      </span>
    </div>
  );
}


/** UI language picker (D27). Language names are shown in their own language. */
function LanguagePicker() {
  const t = useStrings();
  const locale = useLocaleStore((s) => s.locale);
  return (
    <label className="flex items-center gap-1 text-sm text-neutral-700">
      <Languages className="size-4" aria-hidden />
      <span className="sr-only">{t.toolbar.language}</span>
      <select
        className="h-8 rounded-md border border-neutral-300 bg-white px-1.5"
        value={locale}
        onChange={(e) => useLocaleStore.getState().setLocale(e.target.value as Locale)}
        data-testid="language"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Fit of the image pages the page commands act on: selection, or the current page. */
function useTargetImageFit(): "a4" | "image" | "mixed" | null {
  const pages = useDocumentStore((s) => s.doc.pages);
  const selected = useDocumentStore((s) => s.selection.ids);
  const current = useViewStore((s) => s.currentPage);
  const targets = selected.size ? pages.filter((p) => selected.has(p.id)) : pages.slice(current, current + 1);
  const fits = new Set(targets.flatMap((p) => (p.imageFit ? [p.imageFit] : [])));
  if (!fits.size) return null;
  return fits.size > 1 ? "mixed" : [...fits][0];
}

export function Toolbar() {
  const t = useStrings();
  const empty = useDocumentStore((s) => s.doc.pages.length === 0);
  const canUndo = useDocumentStore((s) => s.history.past.length > 0);
  const canRedo = useDocumentStore((s) => s.history.future.length > 0);
  const imageFit = useTargetImageFit();
  const scale = useViewStore((s) => s.scale);
  const zoomMode = useViewStore((s) => s.zoomMode);
  const thumbnailsOpen = useViewStore((s) => s.thumbnailsOpen);
  const view = useViewStore.getState;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-neutral-300 bg-white px-2">
      <IconButton label={`${t.toolbar.newDocument} (Ctrl+N)`} onClick={() => void newDocument()} testId="new-document">
        <File />
      </IconButton>
      <Button variant="ghost" onClick={() => void pickAndAddFiles()} data-testid="add-files">
        <FilePlus2 />
        {t.toolbar.addFiles}
      </Button>
      <IconButton label={`${t.save.save} (Ctrl+S)`} disabled={empty} onClick={() => void save()} testId="save">
        <Save />
      </IconButton>
      <IconButton label={`${t.save.saveAs} (Ctrl+Shift+S)`} disabled={empty} onClick={() => void saveAs()} testId="save-as">
        <SaveAll />
      </IconButton>
      <Divider />
      <IconButton label={`${t.history.undo} (Ctrl+Z)`} disabled={!canUndo} onClick={() => useDocumentStore.getState().undo()} testId="undo">
        <Undo2 />
      </IconButton>
      <IconButton label={`${t.history.redo} (Ctrl+Y)`} disabled={!canRedo} onClick={() => useDocumentStore.getState().redo()} testId="redo">
        <Redo2 />
      </IconButton>
      <Divider />
      <IconButton label={`${t.pages.rotateLeft} (Ctrl+[)`} disabled={empty} onClick={() => rotateTargets(-90)} testId="rotate-left">
        <RotateCcw />
      </IconButton>
      <IconButton label={`${t.pages.rotateRight} (Ctrl+])`} disabled={empty} onClick={() => rotateTargets(90)} testId="rotate-right">
        <RotateCw />
      </IconButton>
      <IconButton label={`${t.pages.delete} (Delete)`} disabled={empty} onClick={deleteTargets} testId="delete-pages">
        <Trash2 />
      </IconButton>
      {imageFit && (
        <div className="ml-1 flex items-center gap-0.5 rounded-md bg-neutral-100 p-0.5" role="group" aria-label={t.pages.imageFit}>
          <IconButton label={t.pages.fitA4} pressed={imageFit === "a4"} onClick={() => setFitOfTargets("a4")} testId="fit-a4">
            <RectangleVertical />
          </IconButton>
          <IconButton label={t.pages.fitImage} pressed={imageFit === "image"} onClick={() => setFitOfTargets("image")} testId="fit-image">
            <Image />
          </IconButton>
        </div>
      )}
      <Divider />
      <IconButton label={t.toolbar.toggleThumbnails} pressed={thumbnailsOpen} onClick={() => view().toggleThumbnails()}>
        <PanelLeft />
      </IconButton>
      <Divider />
      <IconButton label={t.toolbar.zoomOut} disabled={empty || scale <= MIN_SCALE} onClick={() => view().zoomStep(-1)} testId="zoom-out">
        <ZoomOut />
      </IconButton>
      <span className="w-14 text-center text-sm tabular-nums" aria-label={t.toolbar.zoomLevel} data-testid="zoom-level">
        {Math.round(scale * 100)}%
      </span>
      <IconButton label={t.toolbar.zoomIn} disabled={empty || scale >= MAX_SCALE} onClick={() => view().zoomStep(1)} testId="zoom-in">
        <ZoomIn />
      </IconButton>
      <IconButton label={t.toolbar.fitWidth} disabled={empty} pressed={zoomMode === "fitWidth"} onClick={() => view().setZoomMode("fitWidth")} testId="fit-width">
        <MoveHorizontal />
      </IconButton>
      <IconButton label={t.toolbar.fitPage} disabled={empty} pressed={zoomMode === "fitPage"} onClick={() => view().setZoomMode("fitPage")} testId="fit-page">
        <Scan />
      </IconButton>
      <div className="ml-auto flex items-center gap-3 pr-2">
        <PageNumberInput />
        <Divider />
        <LanguagePicker />
      </div>
    </header>
  );
}
