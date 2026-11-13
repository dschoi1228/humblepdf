import { FilePlus2, MoveHorizontal, PanelLeft, Scan, ZoomIn, ZoomOut } from "lucide-react";
import { useState, type ReactNode } from "react";
import { pickAndAddFiles } from "../app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDocumentStore } from "../state/documentStore";
import { useViewStore } from "../state/viewStore";
import { ko } from "../strings/ko";
import { MAX_SCALE, MIN_SCALE } from "../viewer/layout";

function IconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={props.pressed ? "secondary" : "ghost"}
          size="icon"
          aria-label={props.label}
          aria-pressed={props.pressed}
          disabled={props.disabled}
          onClick={props.onClick}
          data-testid={props.testId}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

function PageNumberInput() {
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
        aria-label={ko.toolbar.pageNumber}
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
        {ko.toolbar.pageOf(total)}
      </span>
    </div>
  );
}

export function Toolbar() {
  const empty = useDocumentStore((s) => s.doc.pages.length === 0);
  const scale = useViewStore((s) => s.scale);
  const zoomMode = useViewStore((s) => s.zoomMode);
  const thumbnailsOpen = useViewStore((s) => s.thumbnailsOpen);
  const view = useViewStore.getState;

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-neutral-300 bg-white px-2">
      <Button variant="ghost" onClick={() => void pickAndAddFiles()} data-testid="add-files">
        <FilePlus2 />
        {ko.toolbar.addFiles}
      </Button>
      <Separator orientation="vertical" className="mx-1 !h-6" />
      <IconButton label={ko.toolbar.toggleThumbnails} pressed={thumbnailsOpen} onClick={() => view().toggleThumbnails()}>
        <PanelLeft />
      </IconButton>
      <Separator orientation="vertical" className="mx-1 !h-6" />
      <IconButton label={ko.toolbar.zoomOut} disabled={empty || scale <= MIN_SCALE} onClick={() => view().zoomStep(-1)} testId="zoom-out">
        <ZoomOut />
      </IconButton>
      <span className="w-14 text-center text-sm tabular-nums" aria-label={ko.toolbar.zoomLevel} data-testid="zoom-level">
        {Math.round(scale * 100)}%
      </span>
      <IconButton label={ko.toolbar.zoomIn} disabled={empty || scale >= MAX_SCALE} onClick={() => view().zoomStep(1)} testId="zoom-in">
        <ZoomIn />
      </IconButton>
      <IconButton label={ko.toolbar.fitWidth} disabled={empty} pressed={zoomMode === "fitWidth"} onClick={() => view().setZoomMode("fitWidth")} testId="fit-width">
        <MoveHorizontal />
      </IconButton>
      <IconButton label={ko.toolbar.fitPage} disabled={empty} pressed={zoomMode === "fitPage"} onClick={() => view().setZoomMode("fitPage")} testId="fit-page">
        <Scan />
      </IconButton>
      <div className="ml-auto pr-2">
        <PageNumberInput />
      </div>
    </header>
  );
}
