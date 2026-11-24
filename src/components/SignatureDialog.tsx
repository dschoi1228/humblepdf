// Signature library dialog (SPEC 6.8, D30, D31, D44): list with previews, add an image (with
// white background removal), draw, rename, delete.
import { ImagePlus, Pencil, PenLine, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { backend, isBackendError } from "../backend";
import type { PickedFile, SignatureMeta } from "../backend/types";
import { SignatureDraw, SignatureImport } from "./SignatureCreate";
import { errorMessage, useStrings } from "../i18n";
import { useSignatureStore, type InUseError } from "../signatures/signatureStore";

const isInUse = (e: unknown): e is InUseError => isBackendError(e) && e.code === "in_use";

function fileStem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function Row(props: { sig: SignatureMeta }) {
  const t = useStrings();
  const { sig } = props;
  const url = useSignatureStore((s) => s.urls[sig.id]);
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(sig.name);
  useEffect(() => useSignatureStore.getState().ensureUrl(sig.id), [sig.id]);

  const fail = (e: unknown) => {
    if (isInUse(e)) toast.error(t.signatures.inUse(e.pages.join(", ")));
    else toast.error(t.signatures.failed, { description: errorMessage(isBackendError(e) ? e.code : "generic") });
  };
  const rename = async () => {
    try {
      await useSignatureStore.getState().rename(sig.id, name);
      setMode("view");
    } catch (e) {
      fail(e);
    }
  };
  const remove = async () => {
    try {
      await useSignatureStore.getState().remove(sig.id);
    } catch (e) {
      setMode("view");
      fail(e);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-md border border-neutral-200 p-2" data-testid="signature-row" data-signature-id={sig.id}>
      <div className="grid h-12 w-24 shrink-0 place-items-center rounded bg-[repeating-conic-gradient(#f3f4f6_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
        {url && <img src={url} alt="" className="size-full min-h-0 min-w-0 object-contain" data-testid="signature-preview" />}
      </div>
      {mode === "rename" ? (
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t.signatures.name} autoFocus data-testid="signature-name" />
          <Button type="submit" size="sm" data-testid="signature-rename-save">
            {t.signatures.save}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode("view")}>
            {t.signatures.cancel}
          </Button>
        </form>
      ) : mode === "delete" ? (
        <div className="flex flex-1 items-center gap-2">
          <span className="flex-1 text-sm">{t.signatures.confirmDelete(sig.name)}</span>
          <Button size="sm" variant="destructive" onClick={() => void remove()} data-testid="signature-delete-confirm">
            {t.signatures.delete}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
            {t.signatures.cancel}
          </Button>
        </div>
      ) : (
        <>
          <span className="flex-1 truncate text-sm" data-testid="signature-label">
            {sig.name}
          </span>
          <Button size="icon" variant="ghost" aria-label={t.signatures.rename} title={t.signatures.rename} onClick={() => { setName(sig.name); setMode("rename"); }} data-testid="signature-rename">
            <Pencil />
          </Button>
          <Button size="icon" variant="ghost" aria-label={t.signatures.delete} title={t.signatures.delete} onClick={() => setMode("delete")} data-testid="signature-delete">
            <Trash2 />
          </Button>
        </>
      )}
    </li>
  );
}

export function SignatureDialog() {
  const t = useStrings();
  const open = useSignatureStore((s) => s.dialogOpen);
  const list = useSignatureStore((s) => s.list);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<{ kind: "list" } | { kind: "import"; file: PickedFile } | { kind: "draw" }>({ kind: "list" });

  // Each time the dialog opens it shows the list (state adjusted while rendering).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMode({ kind: "list" });
  }

  const pick = async () => {
    setBusy(true);
    try {
      const file = await backend.pickSignatureFile();
      if (file) setMode({ kind: "import", file });
    } finally {
      setBusy(false);
    }
  };

  /** Runs an add; on success the dialog returns to the list. */
  const added = async (run: () => Promise<SignatureMeta>) => {
    try {
      const meta = await run();
      toast.success(t.signatures.added(meta.name));
      setMode({ kind: "list" });
    } catch (e) {
      toast.error(t.signatures.failed, { description: errorMessage(isBackendError(e) ? e.code : "generic") });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && useSignatureStore.getState().closeDialog()}>
      <DialogContent className="sm:max-w-lg" data-testid="signature-dialog">
        <DialogHeader>
          <DialogTitle>{t.signatures.title}</DialogTitle>
          <DialogDescription>{t.signatures.description}</DialogDescription>
        </DialogHeader>
        {mode.kind === "import" ? (
          <SignatureImport
            file={mode.file}
            defaultName={fileStem(mode.file.name)}
            onSave={(name, removeWhite) => added(() => useSignatureStore.getState().add(mode.file, name, removeWhite))}
            onCancel={() => setMode({ kind: "list" })}
          />
        ) : mode.kind === "draw" ? (
          <SignatureDraw
            defaultName={t.signatures.drawnName(list.length + 1)}
            onSave={(png, name) => added(() => useSignatureStore.getState().addPng(png, name))}
            onCancel={() => setMode({ kind: "list" })}
          />
        ) : (
          <>
            {list.length ? (
              <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {list.map((s) => (
                  <Row key={s.id} sig={s} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-neutral-500">{t.signatures.empty}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => void pick()} disabled={busy} data-testid="signature-add">
                <ImagePlus />
                {t.signatures.add}
              </Button>
              <Button variant="outline" onClick={() => setMode({ kind: "draw" })} data-testid="signature-draw-open">
                <PenLine />
                {t.signatures.draw}
              </Button>
              <Button onClick={() => useSignatureStore.getState().closeDialog()}>{t.signatures.close}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
