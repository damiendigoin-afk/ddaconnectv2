/** Action IXELLIO en un clic : interroger, compléter uniquement les champs vides de `ref_vehicles`, auditer, rafraîchir. */
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logChanges } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import { lookupIxellioVehicle } from "@/lib/ixellio.functions";
import { planFillEmpty, REF_FIELD_LABELS } from "@/lib/ixellio-map";
import { saveRefVehicle } from "@/lib/ref-vehicle-edit";

type Veh = Record<string, unknown> & { id: string };

export function IxellioFillButton({ vehicle, disabled }: { vehicle: Veh; disabled?: boolean }) {
  const lookup = useServerFn(lookupIxellioVehicle);
  const { user, displayName } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const plate = String(vehicle["registration_normalized"] ?? vehicle["registration_display"] ?? "").replace(/[^A-Za-z0-9]/g, "");

  async function run() {
    if (plate.length < 4) return toast.error("Immatriculation absente : interrogation IXELLIO impossible.");
    setBusy(true);
    try {
      const res = await lookup({ data: { plate } });
      if (!res.ok) {
        toast.error(res.message || "IXELLIO n'a renvoyé aucune donnée.");
        return;
      }
      const plan = planFillEmpty(vehicle, res.vehicle);
      const diff = plan.kept.filter((k) => !k.same);
      const diffNote = diff.length
        ? ` · ${diff.length} valeur(s) DDA conservée(s) (IXELLIO différent : ${diff.map((d) => REF_FIELD_LABELS[d.key]).join(", ")})`
        : "";
      if (!plan.toAdd.length) {
        toast.info(`IXELLIO : aucun champ vide à compléter${diffNote}`);
        return;
      }
      await saveRefVehicle(supabase as never, vehicle.id, plan.patch);
      await logChanges({ entity: "vehicle", entityId: vehicle.id, before: vehicle, after: plan.patch, userId: user?.id ?? null, userName: displayName || null });
      await qc.invalidateQueries({ queryKey: ["ref-vehicle", vehicle.id] });
      toast.success(`${plan.toAdd.length} champ(s) complété(s) : ${plan.toAdd.map((f) => REF_FIELD_LABELS[f.key]).join(", ")}${diffNote}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Interrogation IXELLIO impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy || disabled}
      title={disabled ? "Enregistrez d'abord vos modifications" : "Compléter les champs vides avec IXELLIO"}
      aria-label="Compléter avec IXELLIO"
      className="flex h-9 shrink-0 items-center gap-1 rounded-lg border-2 border-border bg-card px-2 text-[11px] font-extrabold uppercase disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-brand" />}
      {busy ? "IXELLIO…" : "Compléter"}
    </button>
  );
}
