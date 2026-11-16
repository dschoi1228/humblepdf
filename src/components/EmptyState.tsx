import { FilePlus2, FileText } from "lucide-react";
import { pickAndAddFiles } from "../app/actions";
import { Button } from "@/components/ui/button";
import { useStrings } from "../i18n";

export function EmptyState() {
  const t = useStrings();
  return (
    <div className="grid h-full place-items-center bg-neutral-100" data-testid="empty-state">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <FileText className="size-12 text-neutral-400" aria-hidden />
        <h2 className="text-lg font-semibold">{t.empty.title}</h2>
        <p className="text-sm text-neutral-600">{t.empty.hint}</p>
        <Button onClick={() => void pickAndAddFiles()}>
          <FilePlus2 />
          {t.toolbar.addFiles}
        </Button>
      </div>
    </div>
  );
}
