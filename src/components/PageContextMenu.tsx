// Right-click menu of the thumbnail panel (SPEC 6.3): rotate, delete, image fit. Acts on
// the selected pages (the panel selects the clicked page first if it was not selected).
import { RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ImageFit } from "../bindings/ImageFit";
import { deleteTargets, imageTargets, rotateTargets, setFitOfTargets } from "../app/pageActions";
import { ko } from "../strings/ko";
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
  const [images, setImages] = useState<{ count: number; fit: ImageFit | null }>({ count: 0, fit: null });
  return (
    <ContextMenu onOpenChange={(open) => open && setImages(imageTargets())}>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52" data-testid="page-menu">
        <ContextMenuItem onSelect={() => rotateTargets(-90)}>
          <RotateCcw />
          {ko.pages.rotateLeft}
          <ContextMenuShortcut>Ctrl+[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => rotateTargets(90)}>
          <RotateCw />
          {ko.pages.rotateRight}
          <ContextMenuShortcut>Ctrl+]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={deleteTargets}>
          <Trash2 />
          {ko.pages.delete}
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
        {images.count > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel>{ko.pages.imageFit}</ContextMenuLabel>
            <ContextMenuRadioGroup value={images.fit ?? ""} onValueChange={(v) => setFitOfTargets(v as ImageFit)}>
              <ContextMenuRadioItem value="a4">{ko.pages.fitA4}</ContextMenuRadioItem>
              <ContextMenuRadioItem value="image">{ko.pages.fitImage}</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
