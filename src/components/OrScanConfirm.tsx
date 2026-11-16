import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OrScanData, OrScanDoubt } from "@/lib/or-scan-validate";
import { isGenericDoubt, OR_CONFIRM_FIELDS, resolveOrConfirm } from "@/lib/or-scan-confirm";
import { applyVehicleSource, frDay, isoDay, type IxellioCross, type VehicleSourceChoice } from "@/lib/vehicle-dates";
import { normalizeVin, vinIssueMessage } from "@/lib/vin";

type Pending = { data: OrScanData; doubts: OrScanDoubt[]; orNumber: string | null; ix: IxellioCross | null; resolve: (d: OrScanData | null) => void };

const FIELDS = OR_CONFIRM_FIELDS;

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
  // VIN divergent : choix exclusif de la source (aucun enrichissement avant ce choix).
  const [source, setSource] = useState<"" | VehicleSourceChoice>("");
  const readVinNorm = normalizeVin(pending.data.vehicle["vin"]);
  const ixFillsVin = !!ix && ix.status === "ok" && !ix.vinMismatch && !readVinNorm.candidate && !!ix.ixVin;
  const [vin, setVin] = useState<string>(() => readVinNorm.vin ?? readVinNorm.candidate ?? (ixFillsVin ? ix!.ixVin! : ""));
  const [vinSource, setVinSource] = useState<string>(() => ixFillsVin ? "ixellio" : "ocr_or");
  const [vinEdited, setVinEdited] = useState(false);
  const needsCheckInit = pending.doubts.some(isGenericDoubt);
  const [showCheck, setShowCheck] = useState(needsCheckInit);
  function chooseSource(k: VehicleSourceChoice) {
    if (!ix) return;
    setSource(k);
    const v = applyVehicleSource(pending.data.vehicle, ix, k);
    const n = normalizeVin(v["vin"]);
    setVin(n.vin ?? n.candidate ?? ""); setVinSource(k === "ixellio" ? "ixellio" : "ocr_or"); setVinEdited(false);
    const m = isoDay(v["first_registration"]) ?? "";
    setMec(m); setMecSource(m ? (k === "ixellio" && ix.ixMec ? "ixellio" : "ocr_or") : "manuel");
    setVals((s) => ({ ...s, "vehicle.brand": String(v["brand"] ?? ""), "vehicle.model": String(v["model"] ?? "") }));
    setErr(null);
  }
  const [delivery, setDelivery] = useState<string>(() => isoDay(pending.data.vehicle["delivery_date"]) ?? "");
  const [err, setErr] = useState<string | null>(null);
  const flagged = new Set(pending.doubts.map((d) => d.field));

  function submit() {
    const r = resolveOrConfirm(pending, { vals, checked, vin, vinSource, vinEdited, source, mec, mecSource, mecChoice, delivery });
    if (!r.ok) { if (r.needsCheck) setShowCheck(true); setErr(r.error); return; }
    onDone(r.data);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onDone(null); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vérifier la lecture de l'OR{pending.orNumber ? ` ${pending.orNumber}` : ""}</DialogTitle>
          <DialogDescription>Vérifiez les points signalés et les dates. Rien n'est créé avant votre validation.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {pending.doubts.filter((d) => d.code !== "ixellio_vin_mismatch" && d.code !== "ixellio_mec_conflict").map((d) => (
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
        {ix?.vinMismatch ? (
          <fieldset className="space-y-2 rounded-md border-2 border-destructive p-2" role="radiogroup" aria-label="Source des données véhicule">
            <legend className="px-1 text-xs font-bold uppercase">VIN différent : quelle source utiliser ?</legend>
            {([
              ["ixellio", "Utiliser les données Ixellio", ix.ixVin, ix.ixMec, [ix.ixBrand, ix.ixModel].filter(Boolean).join(" ")],
              ["or", "Conserver les données du scan OR", ix.readVin, readMec || null, [pending.data.vehicle["brand"], pending.data.vehicle["model"]].filter(Boolean).join(" ")],
            ] as const).map(([k, label, v, m, bm]) => (
              <label key={k} className={`flex cursor-pointer gap-3 rounded-md border-2 p-3 ${source === k ? "border-primary bg-muted" : "border-border"}`}>
                <input type="radio" name="vehicle-source" className="mt-1 h-5 w-5" checked={source === k} onChange={() => chooseSource(k)} />
                <span className="text-sm">
                  <span className="block font-bold">{label}</span>
                  <span className="block font-mono text-xs">VIN : {v || "—"}</span>
                  <span className="block text-xs">MEC : {m ? frDay(m) : "—"}{bm ? ` · ${bm}` : ""}</span>
                </span>
              </label>
            ))}
            <p className="text-[11px] text-muted-foreground">
              {source ? "Valeurs retenues ci-dessous, modifiables. Kilométrage, client, OR et livraison restent ceux du scan." : "Choisissez une source : rien n'est enrichi avant votre choix."}
            </p>
          </fieldset>
        ) : null}
        <label className="block text-xs font-bold">
          VIN
          <input value={vin} onChange={(e) => { setVin(e.target.value.toUpperCase()); setVinEdited(true); }} autoCapitalize="characters" spellCheck={false}
            className={`mt-1 w-full rounded-md border-2 bg-card px-2 py-2 font-mono text-sm font-normal ${vinIssueMessage(normalizeVin(vin)) ? "border-destructive" : "border-border"}`} />
          <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
            {vinIssueMessage(normalizeVin(vin)) ?? (vin ? `Source : ${vinEdited ? "saisie" : vinSource === "ixellio" ? "Ixellio" : "lecture OR"}${ix?.readVinRaw && !vinEdited && vinSource !== "ixellio" ? ` (lu « ${ix.readVinRaw} », O corrigé en 0)` : ""}` : "Absent — saisie possible")}
          </span>
        </label>
        <fieldset className="space-y-2 rounded-md border border-border p-2">
          <legend className="px-1 text-xs font-bold uppercase">Dates du véhicule</legend>
          {ix ? (
            (() => {
              const label = (k: string) => (k === "ixellio" ? "Ixellio" : k === "or" || k === "ocr_or" ? "scan OR" : k === "none" ? "aucune MEC" : "saisie manuelle");
              const resolved = ix.vinMismatch ? (source ? `Source retenue : ${label(source)}.` : null)
                : ix.mec === "conflict" ? (mecChoice ? `MEC retenue : ${label(mecChoice)}.` : mecSource === "manuel" && mec ? "MEC retenue : saisie manuelle." : null) : null;
              const pendingIssue = (ix.vinMismatch || ix.mec === "conflict") && !resolved;
              return (
                <p className={`text-xs ${pendingIssue || ix.status !== "ok" ? "text-destructive" : "text-muted-foreground"}`}>
                  {resolved ?? `Ixellio : ${ix.message}${ix.status === "ok" && ix.ixVin && !ix.vinMismatch ? ` · VIN ${ix.ixVin}` : ""}`}
                </p>
              );
            })()
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
              {([["ixellio", `Utiliser la MEC Ixellio (${frDay(ix.ixMec)})`], ["or", `Conserver la MEC du scan OR (${frDay(readMec)})`], ["none", "Aucune (à vérifier)"]] as const).map(([k, label]) => (
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
        </fieldset>
        {showCheck ? <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4" />
          J'ai vérifié ces valeurs
        </label> : null}
        {err ? <p role="alert" className="text-xs text-destructive">{err}</p> : null}
        <DialogFooter className="gap-2">
          <button type="button" className="rounded-lg bg-secondary px-4 py-3 font-bold" onClick={() => onDone(null)}>Annuler</button>
          <button type="button" className="rounded-lg bg-primary px-4 py-3 font-bold uppercase text-primary-foreground" onClick={submit}>Valider et continuer</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
