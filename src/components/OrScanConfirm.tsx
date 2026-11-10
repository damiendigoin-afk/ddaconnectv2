import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { assessOrScan, checkPlate, type OrScanData, type OrScanDoubt } from "@/lib/or-scan-validate";
import { formatPlate } from "@/lib/plate";
import { frDay, isoDay, type IxellioCross } from "@/lib/vehicle-dates";

type Pending = { data: OrScanData; doubts: OrScanDoubt[]; orNumber: string | null; ix: IxellioCross | null; resolve: (d: OrScanData | null) => void };

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
export function useOrScanConfirm(): { confirm: (data: OrScanData, doubts: OrScanDoubt[], orNumber: string | null, ix?: IxellioCross | null) => Promise<OrScanData | null>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback(
    (data: OrScanData, doubts: OrScanDoubt[], orNumber: string | null, ix?: IxellioCross | null) => new Promise<OrScanData | null>((resolve) => setPending({ data, doubts, orNumber, ix: ix ?? null, resolve })),
    [],
  );
  const close = (d: OrScanData | null) => { pending?.resolve(d); setPending(null); };
  return { confirm, dialog: pending ? <OrScanConfirmDialog key={JSON.stringify(pending.data)} pending={pending} onDone={close} /> : null };
}

function OrScanConfirmDialog({ pending, onDone }: { pending: Pending; onDone: (d: OrScanData | null) => void }) {
  const init = (g: "vehicle" | "client", k: string) => String((pending.data[g] as Record<string, unknown>)[k] ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [`${f.group}.${f.key}`, init(f.group, f.key)])));
  const [checked, setChecked] = useState(false);
  const ix = pending.ix;
  const readMec = isoDay(pending.data.vehicle["first_registration"]) ?? "";
  // MEC : lue sur l'OR, sinon Ixellio (si VIN cohérent) ; un conflit exige un choix explicite.
  const [mec, setMec] = useState<string>(() => readMec || (ix && !ix.vinMismatch && ix.mec === "fill" ? ix.ixMec ?? "" : ""));
  const [mecSource, setMecSource] = useState<string>(() => readMec ? "ocr_or" : ix && !ix.vinMismatch && ix.mec === "fill" ? "ixellio" : "manuel");
  const [mecChoice, setMecChoice] = useState<"" | "or" | "ixellio" | "none">("");
  const [vinChecked, setVinChecked] = useState(false);
  const [delivery, setDelivery] = useState<string>(() => isoDay(pending.data.vehicle["delivery_date"]) ?? "");
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
    const again = assessOrScan({ data: next, orNumber: pending.orNumber, });
    const blocking = again.doubts.filter((d) => d.blocking);
    // Doutes de plaque initiaux (deux lectures différentes) : levés seulement par vérification explicite ou correction.
    const plateDoubtLeft = !plateEdited && pending.doubts.some((d) => d.code === "plate_two_readings");
    if ((blocking.length || plateDoubtLeft) && !checked) { setErr("Corrigez les valeurs signalées ou cochez « J'ai vérifié ces valeurs »."); return; }
    // Dates : MEC distincte de la livraison, conflit Ixellio arbitré, VIN divergent validé.
    if (plateEdited && mecSource === "ixellio") { setErr("Immatriculation modifiée : la MEC Ixellio concerne l'ancienne plaque. Saisissez la MEC ou videz-la."); return; }
    if (ix?.vinMismatch && !vinChecked && mecSource === "ixellio") { setErr("VIN divergent : confirmez le VIN avant d'utiliser la MEC Ixellio."); return; }
    if (ix?.mec === "conflict" && !ix.vinMismatch && !mecChoice) { setErr("Choisissez la MEC à retenir (OR, Ixellio ou aucune)."); return; }
    if (mec && delivery && mec === delivery) { setErr("La 1re MEC ne peut pas être la date de livraison : corrigez ou videz la MEC."); return; }
    if (mec && !isoDay(mec)) { setErr("Date de 1re MEC invalide."); return; }
    if (mec && mec > new Date().toISOString().slice(0, 10)) { setErr("La 1re MEC ne peut pas être future."); return; }
    if (mec) { vehicle["first_registration"] = mec; vehicle["first_registration_source"] = mecSource; } else { vehicle["first_registration"] = null; delete vehicle["first_registration_source"]; }
    if (delivery) vehicle["delivery_date"] = delivery; else delete vehicle["delivery_date"];
    if (checked && checkPlate(vehicle["plate"]) === "atypical") vehicle["plate_confirmed"] = true;
    if (ix?.vinMismatch && !checked) { setErr("VIN Ixellio différent : vérifiez le VIN puis cochez « J'ai vérifié ces valeurs »."); return; }
    const dates = { first_registration: vehicle["first_registration"] ?? null, ...(vehicle["first_registration_source"] ? { first_registration_source: vehicle["first_registration_source"] } : {}), ...(vehicle["delivery_date"] ? { delivery_date: vehicle["delivery_date"] } : {}) };
    const outVehicle: Record<string, unknown> = { ...again.data.vehicle, ...dates, ...(vehicle["plate_confirmed"] ? { plate_confirmed: true } : {}) };
    if (!vehicle["delivery_date"]) delete outVehicle["delivery_date"];
    onDone({ ...again.data, vehicle: outVehicle });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onDone(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vérifier la lecture de l'OR{pending.orNumber ? ` ${pending.orNumber}` : ""}</DialogTitle>
          <DialogDescription>Vérifiez les points signalés et les dates. Rien n'est créé avant votre validation.</DialogDescription>
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
        <fieldset className="space-y-2 rounded-md border border-border p-2">
          <legend className="px-1 text-xs font-bold uppercase">Dates du véhicule</legend>
          {ix ? (
            <p className={`text-xs ${ix.status === "ok" && !ix.vinMismatch ? "text-muted-foreground" : "text-destructive"}`}>
              Ixellio : {ix.message}{ix.status === "ok" && ix.ixVin ? ` · VIN ${ix.ixVin}` : ""}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold">
              1re mise en circulation
              <input type="date" value={mec} onChange={(e) => { setMec(e.target.value); setMecSource("manuel"); setMecChoice(""); }}
                className={`mt-1 w-full rounded-md border-2 bg-card px-2 py-2 text-sm font-normal ${flagged.has("first_registration") ? "border-destructive" : "border-border"}`} />
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                {mec ? `Source : ${mecSource === "ixellio" ? "Ixellio" : mecSource === "ocr_or" ? "lecture OR" : "saisie"}` : "Absente — saisie possible"}
              </span>
            </label>
            <label className="text-xs font-bold">
              Date de livraison (≠ MEC)
              <input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} className="mt-1 w-full rounded-md border-2 border-border bg-card px-2 py-2 text-sm font-normal" />
            </label>
          </div>
          {ix?.mec === "conflict" && !ix.vinMismatch ? (
            <div className="space-y-1 text-sm" role="radiogroup" aria-label="MEC à retenir">
              {([["or", `MEC de l'OR (${frDay(readMec)})`], ["ixellio", `MEC Ixellio (${frDay(ix.ixMec)})`], ["none", "Aucune (à vérifier)"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="radio" name="mec-choice" checked={mecChoice === k} onChange={() => {
                    setMecChoice(k);
                    if (k === "or") { setMec(readMec); setMecSource("ocr_or"); }
                    else if (k === "ixellio") { setMec(ix.ixMec ?? ""); setMecSource("ixellio"); }
                    else { setMec(""); setMecSource("manuel"); }
                  }} /> {label}
                </label>
              ))}
            </div>
          ) : null}
          {ix?.vinMismatch && ix.ixMec ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={vinChecked} onChange={(e) => { setVinChecked(e.target.checked); if (e.target.checked) { setMec(ix.ixMec ?? ""); setMecSource("ixellio"); } }} className="h-4 w-4" />
              VIN vérifié : utiliser quand même la MEC Ixellio ({frDay(ix.ixMec)})
            </label>
          ) : null}
        </fieldset>
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
