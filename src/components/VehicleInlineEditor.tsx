/** Fiche véhicule éditable directement (sans modale) : enregistre uniquement les champs modifiés dans `ref_vehicles`. */
import { useQueryClient } from "@tanstack/react-query";
import { Car, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { IxellioFillButton } from "@/components/RefVehicleActions";
import { supabase } from "@/integrations/supabase/client";
import { logChanges } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import { buildRefVehiclePatch, EDIT_FIELDS, initialEditForm, saveRefVehicle } from "@/lib/ref-vehicle-edit";
import { vehicleLabel, type RefVehicle } from "@/lib/refbase";

const fr = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");

export function VehicleInlineEditor({ vehicle }: { vehicle: RefVehicle & Record<string, unknown> }) {
  const { user, displayName } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => initialEditForm(vehicle));
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(initialEditForm(vehicle)), [vehicle]);

  const patch = useMemo(() => buildRefVehiclePatch(vehicle, form), [vehicle, form]);
  const dirty = Object.keys(patch).length > 0;
  const plate = vehicle.registration_display ?? vehicle.registration_normalized ?? "";

  async function save() {
    setSaving(true);
    try {
      await saveRefVehicle(supabase as never, vehicle.id, patch);
      await logChanges({ entity: "vehicle", entityId: vehicle.id, before: vehicle, after: patch, userId: user?.id ?? null, userName: displayName || null });
      await qc.invalidateQueries({ queryKey: ["ref-vehicle", vehicle.id] });
      toast.success("Fiche véhicule mise à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card-surface space-y-1 p-4">
      <div className="flex items-center gap-3">
        <Car className="h-6 w-6 text-brand" />
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-extrabold tracking-wide">{plate || "—"}</div>
          <div className="text-sm text-muted-foreground">{vehicleLabel(vehicle)}</div>
        </div>
        <IxellioFillButton vehicle={vehicle as never} disabled={dirty} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        {EDIT_FIELDS.map((f) => (
          <div key={f.key}>
            <dt className="text-[11px] uppercase text-muted-foreground">{f.label}</dt>
            <dd>
              <input
                type={f.kind === "date" ? "date" : "text"}
                inputMode={f.kind === "int" ? "numeric" : undefined}
                value={form[f.key] ?? ""}
                placeholder="—"
                aria-label={f.label}
                onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                className={`-mx-1 w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold outline-none placeholder:text-muted-foreground hover:border-border focus:border-brand ${
                  f.key in patch ? "bg-status-watch-soft" : ""
                }`}
              />
            </dd>
          </div>
        ))}
        <ReadRow label="Dernier km" value={vehicle.last_mileage ? `${vehicle.last_mileage.toLocaleString("fr-FR")} km` : "—"} />
        <ReadRow label="Date du km" value={fr(vehicle.last_mileage_at)} />
        <ReadRow label="Dernier passage" value={fr(vehicle.last_visit_at)} />
        <ReadRow label="Prochain CT" value={fr(vehicle.next_ct_date)} />
      </dl>
      {dirty ? (
        <div className="sticky bottom-2 mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setForm(initialEditForm(vehicle))}
            disabled={saving}
            className="rounded-lg border-2 border-border bg-card px-3 py-3 text-xs font-extrabold uppercase"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enregistrer les modifications ({Object.keys(patch).filter((k) => !k.endsWith("_normalized")).length})
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="py-0.5 font-semibold">{value}</dd>
    </div>
  );
}
