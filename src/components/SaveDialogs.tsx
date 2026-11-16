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
import { useStrings } from "../i18n";

export function SavingDialog() {
  const t = useStrings();
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
            {t.save.saving}
          </DialogTitle>
          <DialogDescription>{t.save.savingDetail}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export function UnsavedDialog() {
  const t = useStrings();
  const pending = useUnsavedPrompt((s) => s.pending);
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && pending?.resolve("cancel")}>
      <DialogContent data-testid="unsaved-dialog">
        <DialogHeader>
          <DialogTitle>{t.unsaved.title}</DialogTitle>
          <DialogDescription>
            {pending?.kind === "close" ? t.unsaved.close : t.unsaved.newDocument}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => pending?.resolve("cancel")} data-testid="unsaved-cancel">
            {t.unsaved.cancel}
          </Button>
          <Button variant="outline" onClick={() => pending?.resolve("discard")} data-testid="unsaved-discard">
            {t.unsaved.discard}
          </Button>
          <Button autoFocus onClick={() => pending?.resolve("save")} data-testid="unsaved-save">
            {t.unsaved.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
