// Find bar over the page view (M14, D49): query field, "n/m" count, previous, next, close.
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { useStrings } from "../i18n";
import { useSearchStore } from "../search/searchStore";
import { IconButton } from "./IconButton";

/** Pause in typing (ms) before the document is searched again. */
const TYPING_DELAY_MS = 150;

export function FindBar() {
  const t = useStrings();
  const open = useSearchStore((s) => s.open);
  const query = useSearchStore((s) => s.query);
  const hits = useSearchStore((s) => s.hits.length);
  const current = useSearchStore((s) => s.current);
  const searching = useSearchStore((s) => s.searching);
  const focus = useSearchStore((s) => s.focus);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(query);
  const [shownQuery, setShownQuery] = useState(query);

  // The query set from outside (Ctrl+F with selected text) replaces what is typed.
  if (query !== shownQuery) {
    setShownQuery(query);
    setText(query);
  }

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
  }, [open, focus]);

  useEffect(() => {
    if (!open || text === useSearchStore.getState().query) return;
    const timer = setTimeout(() => useSearchStore.getState().setQuery(text), TYPING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, text]);

  if (!open) return null;
  const s = useSearchStore.getState;
  /** Runs the pending query at once, then moves. */
  const go = (dir: 1 | -1) => {
    if (text !== s().query) {
      s().setQuery(text);
      return;
    }
    if (dir === 1) s().next();
    else s().prev();
  };
  const status = !text.trim()
    ? ""
    : hits
      ? t.find.count(current + 1, hits) + (searching ? "+" : "")
      : searching
        ? t.find.searching
        : t.find.none;

  return (
    <div
      role="search"
      aria-label={t.find.label}
      className="absolute top-2 right-4 z-20 flex items-center gap-1 rounded-md border border-neutral-300 bg-white p-1 shadow-md"
      data-testid="find-bar"
    >
      <Input
        ref={input}
        value={text}
        placeholder={t.find.placeholder}
        aria-label={t.find.label}
        className="h-8 w-56"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter" || e.key === "F3") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            s().close();
          }
        }}
        data-testid="find-input"
      />
      <span className="min-w-16 px-1 text-center text-xs text-neutral-600 tabular-nums" aria-live="polite" data-testid="find-count">
        {status}
      </span>
      <IconButton label={`${t.find.previous} (Shift+Enter)`} disabled={!hits} onClick={() => go(-1)} testId="find-previous">
        <ChevronUp />
      </IconButton>
      <IconButton label={`${t.find.next} (Enter)`} disabled={!hits} onClick={() => go(1)} testId="find-next">
        <ChevronDown />
      </IconButton>
      <IconButton label={`${t.find.close} (Esc)`} onClick={() => s().close()} testId="find-close">
        <X />
      </IconButton>
    </div>
  );
}
