/** Actions discrètes de la fiche véhicule : compléter via IXELLIO, modifier manuellement (`ref_vehicles`). */
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { logChanges } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import { lookupIxellioVehicle } from "@/lib/ixellio.functions";
import { planFillEmpty, REF_FIELD_LABELS, type FillPlan } from "@/lib/ixellio-map";
import { buildRefVehiclePatch, EDIT_FIELDS, saveRefVehicle } from "@/lib/ref-vehicle-edit";

type Veh = Record<string, unknown> & { id: string };

export function RefVehicleActions({ vehicle }: { vehicle: Veh }) {
  const [open, setOpen] = useState<null | "ixellio" | "edit">(null);
  const btn = "flex h-9 items-center gap-1 rounded-lg border-2 border-border bg-card px-2 text-[11px] font-extrabold uppercase";
  return (
    <div className="flex shrink-0 gap-1">
      <button type="button" className={btn} onClick={() => setOpen("ixellio")} aria-label="Compléter avec IXELLIO">
        <Sparkles className="h-4 w-4 text-brand" /> Compléter
      </button>
      <button type="button" className={btn} onClick={() => setOpen("edit")} aria-label="Modifier le véhicule">
        <Pencil className="h-4 w-4" />
      </button>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {open === "ixellio" ? <IxellioFill vehicle={vehicle} onDone={() => setOpen(null)} /> : null}
          {open === "edit" ? <EditForm vehicle={vehicle} onDone={() => setOpen(null)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useAfterSave(id: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["ref-vehicle", id] });
}

function IxellioFill({ vehicle, onDone }: { vehicle: Veh; onDone: () => void }) {
  const lookup = useServerFn(lookupIxellioVehicle);
  const { user, displayName } = useAuth();
  const refresh = useAfterSave(vehicle.id);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [plan, setPlan] = useState<FillPlan | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const plate = String(vehicle["registration_normalized"] ?? vehicle["registration_display"] ?? "").replace(/[^A-Za-z0-9]/g, "");

  async function ask() {
    setState("loading");
    try {
      const res = await lookup({ data: { plate } });
      setMsg(res.message);
      setPlan(res.ok ? planFillEmpty(vehicle, res.vehicle) : null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Interrogation IXELLIO impossible.");
      setPlan(null);
    }
    setState("done");
  }

  async function apply() {
    if (!plan) return;
    setSaving(true);
    try {
      await saveRefVehicle(supabase as never, vehicle.id, plan.patch);
      await logChanges({ entity: "vehicle", entityId: vehicle.id, before: vehicle, after: plan.patch, userId: user?.id ?? null, userName: displayName || null });
      toast.success(`${plan.toAdd.length} champ(s) complété(s) depuis IXELLIO`);
      await refresh();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mise à jour impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader><DialogTitle>Compléter avec IXELLIO</DialogTitle></DialogHeader>
      <p className="text-xs text-muted-foreground">
        Interrogation par immatriculation. Seuls les champs vides de cette fiche seront complétés ; aucune valeur existante n'est remplacée.
      </p>
      {plate.length < 4 ? <p className="text-sm">Immatriculation absente : interrogation impossible.</p> : null}
      {state === "idle" && plate.length >= 4 ? (
        <button type="button" onClick={() => void ask()} className="rounded-lg bg-brand px-3 py-3 text-sm font-extrabold uppercase text-brand-foreground">
          Interroger IXELLIO
        </button>
      ) : null}
      {state === "loading" ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Interrogation…</p> : null}
      {state === "done" && !plan ? <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-sm">{msg}</p> : null}
      {state === "done" && plan ? (
        <div className="space-y-3 text-sm">
          <div>
            <h4 className="text-xs font-extrabold uppercase">Champs ajoutés ({plan.toAdd.length})</h4>
            {plan.toAdd.length ? (
              <ul className="mt-1 space-y-0.5">
                {plan.toAdd.map((f) => <li key={f.key}><b>{REF_FIELD_LABELS[f.key]}</b> : {String(f.value)}</li>)}
              </ul>
            ) : <p className="text-muted-foreground">Aucun champ vide à compléter.</p>}
          </div>
          {plan.kept.length ? (
            <div>
              <h4 className="text-xs font-extrabold uppercase">Déjà renseignés, non remplacés ({plan.kept.length})</h4>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {plan.kept.map((f) => (
                  <li key={f.key}>
                    {REF_FIELD_LABELS[f.key]} : {f.current}{f.same ? "" : ` (IXELLIO : ${f.proposed})`}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <button
            type="button"
            disabled={saving || !plan.toAdd.length}
            onClick={() => void apply()}
            className="w-full rounded-lg bg-brand px-3 py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Compléter les champs manquants"}
          </button>
        </div>
      ) : null}
    </>
  );
}

function EditForm({ vehicle, onDone }: { vehicle: Veh; onDone: () => void }) {
  const { user, displayName } = useAuth();
  const refresh = useAfterSave(vehicle.id);
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(EDIT_FIELDS.map((f) => {
      const v = vehicle[f.key];
      const s = v == null ? "" : String(v);
      return [f.key, f.kind === "date" ? s.slice(0, 10) : s];
    })),
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const patch = buildRefVehiclePatch(vehicle, form);
    if (!Object.keys(patch).length) return onDone();
    setSaving(true);
    try {
      await saveRefVehicle(supabase as never, vehicle.id, patch);
      await logChanges({ entity: "vehicle", entityId: vehicle.id, before: vehicle, after: patch, userId: user?.id ?? null, userName: displayName || null });
      toast.success("Fiche véhicule mise à jour");
      await refresh();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader><DialogTitle>Modifier le véhicule</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-2">
        {EDIT_FIELDS.map((f) => (
          <label key={f.key} className="text-[11px] font-bold uppercase text-muted-foreground">
            {f.label}
            <input
              type={f.kind === "date" ? "date" : "text"}
              inputMode={f.kind === "int" ? "numeric" : undefined}
              value={form[f.key] ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
              className="mt-0.5 w-full rounded-lg border-2 border-border bg-card px-2 py-2 text-sm font-normal normal-case text-foreground"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="w-full rounded-lg bg-brand px-3 py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50"
      >
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
    </>
  );
}
