import { useState } from "react";
import { toast } from "sonner";

import { btnGhost, inputCls } from "@/components/parts/PartsUi";

/** Action d'annulation avec confirmation explicite et motif obligatoire (jamais un clic direct). */
export function CancelAction({ label, warning, onConfirm }: { label: string; warning: string; onConfirm: (reason: string) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };
  if (!open) return <button type="button" data-action="cancel" className="ml-3 text-xs font-bold text-destructive underline" onClick={(e) => { stop(e); setOpen(true); }}>{label}</button>;
  return (
    <div className="mt-2 space-y-2 rounded-lg border-2 border-destructive p-2 text-xs" onClick={stop}>
      <p className="font-bold">{warning}</p>
      <input className={`${inputCls} h-9 text-xs`} placeholder="Motif (obligatoire) — ex. saisie en double" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btnGhost} onClick={() => { setOpen(false); setReason(""); }}>Retour</button>
        <button
          type="button"
          className="h-10 rounded-lg bg-destructive px-3 text-sm font-bold text-destructive-foreground disabled:opacity-50"
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try { toast.success(await onConfirm(reason.trim())); setOpen(false); }
            catch (e) { toast.error(e instanceof Error ? e.message : "Annulation impossible"); }
            finally { setBusy(false); }
          }}
        >Confirmer l'annulation</button>
      </div>
    </div>
  );
}
