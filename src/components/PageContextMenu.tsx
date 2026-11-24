// Right-click menu of the thumbnail panel (SPEC 6.3): rotate, delete, export, image fit. Acts on
// the selected pages (the panel selects the clicked page first if it was not selected).
import { FileOutput, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { exportPages } from "../app/save";
import { useState, type ReactNode } from "react";
import type { ImageFit } from "../bindings/ImageFit";
import { deleteTargets, imageTargets, rotateTargets, setFitOfTargets, targetPageIds } from "../app/pageActions";
import { useStrings } from "../i18n";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export function PageContextMenu(props: { children: ReactNode }) {
  const t = useStrings();
  const [images, setImages] = useState<{ count: number; fit: ImageFit | null }>({ count: 0, fit: null });
  const [pageCount, setPageCount] = useState(0);
  return (
    // Non-modal: a modal menu hides the app with aria-hidden while the clicked thumbnail
    // still has focus (browser warning).
    <ContextMenu modal={false} onOpenChange={(open) => {
        if (!open) return;
        setImages(imageTargets());
        setPageCount(targetPageIds().size);
      }}>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52" data-testid="page-menu">
        <ContextMenuItem onSelect={() => rotateTargets(-90)}>
          <RotateCcw />
          {t.pages.rotateLeft}
          <ContextMenuShortcut>Ctrl+[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => rotateTargets(90)}>
          <RotateCw />
          {t.pages.rotateRight}
          <ContextMenuShortcut>Ctrl+]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={deleteTargets}>
          <Trash2 />
          {t.pages.delete}
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void exportPages()} data-testid="export-pages">
          <FileOutput />
          {t.pages.exportPages(pageCount)}
        </ContextMenuItem>
        {images.count > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel>{t.pages.imageFit}</ContextMenuLabel>
            <ContextMenuRadioGroup value={images.fit ?? ""} onValueChange={(v) => setFitOfTargets(v as ImageFit)}>
              <ContextMenuRadioItem value="a4">{t.pages.fitA4}</ContextMenuRadioItem>
              <ContextMenuRadioItem value="image">{t.pages.fitImage}</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
