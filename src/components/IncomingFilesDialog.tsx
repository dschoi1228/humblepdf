// Files from a second launch while the document has pages (D46): add them here, or open
// them in a new window.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIncomingPrompt } from "../app/actions";
import { useStrings } from "../i18n";

/** At most this many file names are listed; the rest are counted in the question. */
const LISTED = 5;

export function IncomingFilesDialog() {
  const t = useStrings();
  const pending = useIncomingPrompt((s) => s.pending);
  const names = pending?.names ?? [];
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && pending?.resolve("cancel")}>
      <DialogContent data-testid="incoming-dialog">
        <DialogHeader>
          <DialogTitle>{t.incoming.title}</DialogTitle>
          <DialogDescription>{t.incoming.question(names.length)}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-32 overflow-auto text-sm text-neutral-700" data-testid="incoming-names">
          {names.slice(0, LISTED).map((n, i) => (
            <li key={i} className="truncate">
              {n}
            </li>
          ))}
          {names.length > LISTED && <li className="text-neutral-500">…</li>}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => pending?.resolve("cancel")} data-testid="incoming-cancel">
            {t.incoming.cancel}
          </Button>
          <Button variant="outline" onClick={() => pending?.resolve("window")} data-testid="incoming-window">
            {t.incoming.newWindow}
          </Button>
          <Button autoFocus onClick={() => pending?.resolve("add")} data-testid="incoming-add">
            {t.incoming.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
