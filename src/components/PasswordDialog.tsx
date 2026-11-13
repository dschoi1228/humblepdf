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
import { ko } from "../strings/ko";

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
            <DialogTitle>{ko.password.title}</DialogTitle>
            <DialogDescription>{pending ? ko.password.description(pending.fileName) : ""}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoFocus
            placeholder={ko.password.placeholder}
            aria-label={ko.password.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={pending?.wrong || undefined}
            data-testid="password-input"
          />
          {pending?.wrong && (
            <p className="text-sm text-destructive" role="alert" data-testid="password-wrong">
              {ko.password.wrong}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending?.checking} onClick={() => answer(null)}>
              {ko.password.cancel}
            </Button>
            <Button type="submit" disabled={pending?.checking} data-testid="password-ok">
              {ko.password.ok}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}
