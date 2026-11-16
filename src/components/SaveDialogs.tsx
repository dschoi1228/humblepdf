// Save progress (SPEC 6.9) and the unsaved-changes question (SPEC 6.1).
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSaveStatus, useUnsavedPrompt } from "../app/save";
import { ko } from "../strings/ko";

export function SavingDialog() {
  const saving = useSaveStatus((s) => s.saving);
  return (
    <Dialog open={saving}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-sm"
        data-testid="saving-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LoaderCircle className="size-5 animate-spin" />
            {ko.save.saving}
          </DialogTitle>
          <DialogDescription>{ko.save.savingDetail}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export function UnsavedDialog() {
  const pending = useUnsavedPrompt((s) => s.pending);
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && pending?.resolve("cancel")}>
      <DialogContent data-testid="unsaved-dialog">
        <DialogHeader>
          <DialogTitle>{ko.unsaved.title}</DialogTitle>
          <DialogDescription>
            {pending?.kind === "close" ? ko.unsaved.close : ko.unsaved.newDocument}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => pending?.resolve("cancel")} data-testid="unsaved-cancel">
            {ko.unsaved.cancel}
          </Button>
          <Button variant="outline" onClick={() => pending?.resolve("discard")} data-testid="unsaved-discard">
            {ko.unsaved.discard}
          </Button>
          <Button autoFocus onClick={() => pending?.resolve("save")} data-testid="unsaved-save">
            {ko.unsaved.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
