import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePasswordPrompt } from "../state/passwordPrompt";
import { useStrings } from "../i18n";

export function PasswordDialog() {
  const pending = usePasswordPrompt((s) => s.pending);
  const answer = usePasswordPrompt((s) => s.answer);
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && answer(null)}>
      <DialogContent data-testid="password-dialog">
        {/* A new form (empty field) for every request. */}
        <PasswordForm key={pending?.id ?? 0} />
      </DialogContent>
    </Dialog>
  );
}

function PasswordForm() {
  const t = useStrings();
  const pending = usePasswordPrompt((s) => s.pending);
  const answer = usePasswordPrompt((s) => s.answer);
  const [value, setValue] = useState("");
  return (
    <>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            answer(value);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.password.title}</DialogTitle>
            <DialogDescription>{pending ? t.password.description(pending.fileName) : ""}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoFocus
            placeholder={t.password.placeholder}
            aria-label={t.password.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={pending?.wrong || undefined}
            data-testid="password-input"
          />
          {pending?.wrong && (
            <p className="text-sm text-destructive" role="alert" data-testid="password-wrong">
              {t.password.wrong}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending?.checking} onClick={() => answer(null)}>
              {t.password.cancel}
            </Button>
            <Button type="submit" disabled={pending?.checking} data-testid="password-ok">
              {t.password.ok}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}
