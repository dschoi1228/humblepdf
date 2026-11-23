// Keyboard shortcut help (F1) and About (M7). The help table comes from shortcutHelp.ts,
// which a unit test checks against the real key map.
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInfoDialogs } from "../app/dialogs";
import { HELP, HELP_GROUPS } from "../app/shortcutHelp";
import { useStrings } from "../i18n";

function Keys(props: { keys: string[] }) {
  const t = useStrings();
  const label = (k: string) => (k.startsWith("@") ? (t.help.keys as Record<string, string>)[k.slice(1)] : k);
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {props.keys.map((k) => (
        <kbd key={k} className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-sans text-xs text-neutral-700">
          {label(k)}
        </kbd>
      ))}
    </span>
  );
}

export function HelpDialog() {
  const t = useStrings();
  const open = useInfoDialogs((s) => s.help);
  return (
    <Dialog open={open} onOpenChange={(help) => useInfoDialogs.setState({ help })}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" data-testid="help-dialog">
        <DialogHeader>
          <DialogTitle>{t.help.title}</DialogTitle>
          <DialogDescription className="sr-only">{t.help.open}</DialogDescription>
        </DialogHeader>
        {HELP_GROUPS.map((g) => (
          <section key={g}>
            <h3 className="mb-1 text-sm font-semibold text-neutral-800">{t.help.groups[g]}</h3>
            <dl className="divide-y divide-neutral-100">
              {HELP.filter((h) => h.group === g).map((h) => (
                <div key={h.action} className="flex items-center justify-between gap-4 py-1 text-sm" data-testid="help-row">
                  <dt className="text-neutral-700">{t.help.actions[h.action]}</dt>
                  <dd>
                    <Keys keys={h.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}

export function AboutDialog() {
  const t = useStrings();
  const open = useInfoDialogs((s) => s.about);
  return (
    <Dialog open={open} onOpenChange={(about) => useInfoDialogs.setState({ about })}>
      <DialogContent className="sm:max-w-md" data-testid="about-dialog">
        <DialogHeader>
          <DialogTitle>{t.about.title}</DialogTitle>
          <DialogDescription>{t.about.tagline}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm text-neutral-700">
          <p data-testid="about-version">{t.about.version(__APP_VERSION__)}</p>
          <p>{t.about.license}</p>
          <p>{t.about.offline}</p>
          <p className="text-neutral-500">{t.about.credits}</p>
          <p className="text-neutral-500">{t.about.notices}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
