import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { mergeCtComment, reportCtDates, reportCtStatus } from "@/lib/ct";
import type { ReportData } from "@/lib/report";
import { buildDatesPatch, type CtMode, type CtProof } from "@/lib/vehicle-dates-edit";
import { DATE_SOURCE_LABEL, frDay, validateVehicleDates } from "@/lib/vehicle-dates";

const FIELD_LABEL: Record<string, string> = { first_registration: "1re MEC", delivery_date: "Livraison", ct_due_date: "Échéance CT" };

/**
 * Dates du véhicule sur le compte rendu d'un tour (même terminé) : MEC, livraison, statut CT
 * théorique / vérifié, sources, et correction auditée (fiche véhicule + référentiel + point CT).
 */
export function VehicleDatesCard({ d, userName }: { d: ReportData; userName: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const v = d.vehicle;
  const history = useQuery({
    queryKey: ["vehicle-date-changes", v?.id],
    enabled: Boolean(v?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from("field_changes")
        .select("id, field, old_value, new_value, changed_by_name, created_at")
        .eq("entity_type", "vehicle")
        .eq("entity_id", v!.id)
        .in("field", ["first_registration", "delivery_date", "ct_due_date"])
        .order("created_at", { ascending: false })
        .limit(5);
      return data ?? [];
    },
  });
  if (!v) return null;
  const st = reportCtStatus(d);
  const src = (s?: string | null) => (s ? ` · source : ${DATE_SOURCE_LABEL[s] ?? s}` : "");
  return (
    <div className="card-surface space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          <CalendarClock className="h-4 w-4" aria-hidden /> Dates du véhicule
        </span>
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 rounded-lg border-2 border-border bg-card px-3 py-2 text-xs font-bold uppercase">
          <Pencil className="h-3.5 w-3.5" /> Corriger
        </button>
      </div>
      <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">1re mise en circulation</dt><dd className="font-semibold">{frDay(v.first_registration) || "Non renseignée"}<span className="text-xs font-normal text-muted-foreground">{v.first_registration ? src(v.first_registration_source) : ""}</span></dd></div>
        <div><dt className="text-xs text-muted-foreground">Date de livraison</dt><dd className="font-semibold">{frDay(v.delivery_date) || "Non renseignée"}<span className="text-xs font-normal text-muted-foreground">{v.delivery_date ? src(v.delivery_date_source) : ""}</span></dd></div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Contrôle technique — {st.kind === "verified" ? "date vérifiée" : st.kind === "theoretical" ? "échéance théorique" : "non renseigné"}</dt>
          <dd className="font-semibold">{st.headline}</dd>
          {st.detail ? <dd className="text-xs text-muted-foreground">{st.detail}</dd> : null}
        </div>
      </dl>
      {history.data && history.data.length ? (
        <ul className="space-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
          {history.data.map((h) => (
            <li key={h.id}>
              {new Date(h.created_at).toLocaleString("fr-FR")} — {FIELD_LABEL[h.field] ?? h.field} : {h.old_value ?? "vide"} → {h.new_value ?? "vide"} ({h.changed_by_name ?? "?"})
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <DatesDialog
          d={d}
          userName={userName}
          onClose={() => setOpen(false)}
          onSaved={async () => {
            setOpen(false);
            await qc.invalidateQueries({ queryKey: ["report", d.inspection.id] });
            await qc.invalidateQueries({ queryKey: ["vehicle-date-changes", v.id] });
          }}
        />
      ) : null}
    </div>
  );
}

function DatesDialog({ d, userName, onClose, onSaved }: { d: ReportData; userName: string | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const v = d.vehicle!;
  const ctPoint = d.points.find((p) => p.point_key === "controle_technique");
  const dates = reportCtDates(d);
  const verified = reportCtStatus(d).kind === "verified";
  const [mec, setMec] = useState(v.first_registration ?? "");
  const [delivery, setDelivery] = useState(v.delivery_date ?? "");
  const [ctMode, setCtMode] = useState<CtMode>("keep");
  const [ct, setCt] = useState(verified ? dates.ct ?? "" : "");
  const [proof, setProof] = useState<CtProof | "">("");
  const [attest, setAttest] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setErr(null);
    const bad = validateVehicleDates({ first_registration: mec || null, delivery_date: delivery || null, ct_due_date: ctMode === "real" ? ct || null : null });
    if (bad) return setErr(bad);
    if (mec && delivery && mec === delivery && !window.confirm("La MEC est identique à la date de livraison. Confirmer que c'est bien la date de 1re mise en circulation ?")) return;
    if (ctMode === "real") {
      if (!ct) return setErr("Saisissez la date réelle d'échéance du CT.");
      if (!proof) return setErr("Indiquez la preuve : PV, vignette ou déclaration manuelle.");
      if (!attest) return setErr("Cochez l'attestation : une date réelle exige une preuve ou une déclaration explicite.");
    }
    if (ctMode !== "keep" && !window.confirm(ctMode === "real" ? `Remplacer l'échéance CT officielle par le ${frDay(ct)} ?` : "Retirer la date CT enregistrée et afficher le premier CT théorique ?")) return;
    const patch = buildDatesPatch({
      before: { first_registration: v.first_registration ?? null, delivery_date: v.delivery_date ?? null },
      mec: mec || null, delivery: delivery || null, ctMode, ct: ct || null, proof: proof || null,
      ctComment: ctPoint ? (args) => mergeCtComment(ctPoint.comment, args.ct, dates.pollution, args.theoretical) : null,
      vehicleType: v.vehicle_type ?? null,
      currentCt: verified ? dates.ct : null,
    });
    setSaving(true);
    try {
      const { error } = await supabase.rpc("correct_vehicle_dates", { _inspection: d.inspection.id, _patch: patch as never, _reason: reason.trim(), _user_name: userName ?? "" });
      if (error) throw error;
      toast.success("Dates enregistrées : fiche véhicule, compte rendu et PDF mis à jour.");
      await onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      console.error("[dda] correction dates véhicule", msg);
      setErr(/fetch|network|Failed/i.test(msg) ? "Connexion impossible : rien n'a été modifié. Réessayez." : /not allowed|site/i.test(msg) ? "Vous n'avez pas accès à ce site." : `Enregistrement refusé : ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const input = "mt-1 w-full rounded-md border-2 border-border bg-card px-2 py-2 text-sm font-normal";
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Corriger les dates du véhicule</DialogTitle>
          <DialogDescription>Modifie la fiche véhicule (et le référentiel existant), le point CT et le compte rendu. Les constats et commentaires libres sont conservés.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs font-bold">1re mise en circulation<input type="date" value={mec} onChange={(e) => setMec(e.target.value)} className={input} /></label>
          <label className="text-xs font-bold">Date de livraison (distincte)<input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} className={input} /></label>
        </div>
        <fieldset className="space-y-1 text-sm">
          <legend className="text-xs font-bold uppercase">Contrôle technique</legend>
          <label className="flex items-center gap-2"><input type="radio" name="ct-mode" checked={ctMode === "keep"} onChange={() => setCtMode("keep")} /> Ne pas modifier</label>
          <label className="flex items-center gap-2"><input type="radio" name="ct-mode" checked={ctMode === "theoretical"} onChange={() => setCtMode("theoretical")} /> Aucun CT réel encore : premier CT théorique (MEC + 4 ans)</label>
          <label className="flex items-center gap-2"><input type="radio" name="ct-mode" checked={ctMode === "real"} onChange={() => setCtMode("real")} /> Date réelle validée (PV / vignette)</label>
          {ctMode === "real" ? (
            <div className="space-y-2 rounded-md border border-border p-2">
              <label className="block text-xs font-bold">Valable jusqu'au<input type="date" value={ct} onChange={(e) => setCt(e.target.value)} className={input} /></label>
              <label className="block text-xs font-bold">Preuve
                <select value={proof} onChange={(e) => setProof(e.target.value as CtProof)} className={input}>
                  <option value="">Choisir…</option>
                  <option value="pv">PV de contrôle technique</option>
                  <option value="vignette">Vignette pare-brise / carte grise</option>
                  <option value="declaration">Déclaration manuelle (sans document)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="h-4 w-4" /> J'atteste que cette date est réelle, et non théorique.</label>
            </div>
          ) : null}
        </fieldset>
        <label className="block text-xs font-bold">Motif (facultatif)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={input} placeholder="ex. MEC Ixellio 30/06/2025, OR lu à tort" /></label>
        {err ? <p role="alert" className="text-xs text-destructive">{err}</p> : null}
        <DialogFooter className="gap-2">
          <button type="button" disabled={saving} className="rounded-lg bg-secondary px-4 py-3 font-bold" onClick={onClose}>Annuler</button>
          <button type="button" disabled={saving} className="rounded-lg bg-primary px-4 py-3 font-bold uppercase text-primary-foreground disabled:opacity-60" onClick={() => void save()}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
