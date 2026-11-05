import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { assessOrScan, checkPlate, type OrScanData, type OrScanDoubt } from "@/lib/or-scan-validate";
import { formatPlate } from "@/lib/plate";

type Pending = { data: OrScanData; doubts: OrScanDoubt[]; orNumber: string | null; resolve: (d: OrScanData | null) => void };

const FIELDS: Array<{ key: string; group: "vehicle" | "client"; label: string; doubt: OrScanDoubt["field"] | null; numeric?: boolean }> = [
  { key: "plate", group: "vehicle", label: "Immatriculation", doubt: "plate" },
  { key: "brand", group: "vehicle", label: "Marque", doubt: "brand" },
  { key: "model", group: "vehicle", label: "Modèle", doubt: "model" },
  { key: "mileage", group: "vehicle", label: "Kilométrage", doubt: null, numeric: true },
  { key: "last_name", group: "client", label: "Nom client", doubt: "client" },
  { key: "first_name", group: "client", label: "Prénom", doubt: "client" },
];

/**
 * Confirmation des champs critiques d'un OR lu, affichée UNIQUEMENT en cas de doute.
 * Les valeurs restent modifiables ; les doutes bloquants exigent une case « j'ai vérifié »
 * (ou une correction qui les lève). Annuler ne crée rien.
 */
export function useOrScanConfirm(): { confirm: (data: OrScanData, doubts: OrScanDoubt[], orNumber: string | null) => Promise<OrScanData | null>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback(
    (data: OrScanData, doubts: OrScanDoubt[], orNumber: string | null) => new Promise<OrScanData | null>((resolve) => setPending({ data, doubts, orNumber, resolve })),
    [],
  );
  const close = (d: OrScanData | null) => { pending?.resolve(d); setPending(null); };
  return { confirm, dialog: pending ? <OrScanConfirmDialog key={JSON.stringify(pending.data)} pending={pending} onDone={close} /> : null };
}

function OrScanConfirmDialog({ pending, onDone }: { pending: Pending; onDone: (d: OrScanData | null) => void }) {
  const init = (g: "vehicle" | "client", k: string) => String((pending.data[g] as Record<string, unknown>)[k] ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [`${f.group}.${f.key}`, init(f.group, f.key)])));
  const [checked, setChecked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flagged = new Set(pending.doubts.map((d) => d.field));

  function submit() {
    const vehicle: Record<string, unknown> = { ...pending.data.vehicle };
    const client: Record<string, unknown> = { ...pending.data.client };
    for (const f of FIELDS) {
      const v = vals[`${f.group}.${f.key}`]!.trim();
      const target = f.group === "vehicle" ? vehicle : client;
      if (v) target[f.key] = f.numeric ? v.replace(/\D/g, "") : f.key === "plate" ? formatPlate(v) : v; else delete target[f.key];
    }
    const plateEdited = String(vehicle["plate"] ?? "") !== String(pending.data.vehicle["plate"] ?? "");
    const next: OrScanData = { ...pending.data, vehicle, client };
    if (checkPlate(vehicle["plate"], { orNumber: pending.orNumber, account: client["account_number"] }) === "or_number") {
      setErr("Ce numéro est le n° d'OR, pas une immatriculation."); return;
    }
    const again = assessOrScan({ data: next, orNumber: pending.orNumber, localPlate: plateEdited ? null : undefined });
    const blocking = again.doubts.filter((d) => d.blocking);
    // Doutes de plaque initiaux (deux lectures différentes) : levés seulement par vérification explicite ou correction.
    const plateDoubtLeft = !plateEdited && pending.doubts.some((d) => d.code === "plate_two_readings");
    if ((blocking.length || plateDoubtLeft) && !checked) { setErr("Corrigez les valeurs signalées ou cochez « J'ai vérifié ces valeurs »."); return; }
    if (checked && checkPlate(vehicle["plate"]) === "atypical") vehicle["plate_confirmed"] = true;
    onDone({ ...again.data, vehicle: { ...again.data.vehicle, ...(vehicle["plate_confirmed"] ? { plate_confirmed: true } : {}) } });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onDone(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vérifier la lecture de l'OR{pending.orNumber ? ` ${pending.orNumber}` : ""}</DialogTitle>
          <DialogDescription>Seuls les points douteux sont signalés. Rien n'est créé avant votre validation.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {pending.doubts.map((d) => (
            <li key={d.code} className="flex gap-2 rounded-md border border-border bg-muted p-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>{d.message}</span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map((f) => {
            const id = `${f.group}.${f.key}`;
            return (
              <label key={id} className="text-xs font-bold">
                {f.label}
                <input
                  value={vals[id]}
                  inputMode={f.numeric ? "numeric" : undefined}
                  onChange={(e) => setVals((s) => ({ ...s, [id]: f.key === "plate" ? e.target.value.toUpperCase() : e.target.value }))}
                  className={`mt-1 w-full rounded-md border-2 bg-card px-2 py-2 text-sm font-normal outline-none focus:border-brand ${f.doubt && flagged.has(f.doubt) ? "border-destructive" : "border-border"}`}
                />
              </label>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4" />
          J'ai vérifié ces valeurs
        </label>
        {err ? <p role="alert" className="text-xs text-destructive">{err}</p> : null}
        <DialogFooter className="gap-2">
          <button type="button" className="rounded-lg bg-secondary px-4 py-3 font-bold" onClick={() => onDone(null)}>Annuler</button>
          <button type="button" className="rounded-lg bg-primary px-4 py-3 font-bold uppercase text-primary-foreground" onClick={submit}>Valider et continuer</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
