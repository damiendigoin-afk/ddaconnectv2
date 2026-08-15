import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { logChanges } from "@/lib/audit";
import { useAuth } from "@/lib/auth";
import { normalizePlate } from "@/lib/plate";
import { isValidEmail } from "@/lib/validation";

type Row = Record<string, unknown>;

const CLIENT_FIELDS = [
  ["account_number", "N° compte client"],
  ["last_name", "Nom"],
  ["first_name", "Prénom"],
  ["address", "Adresse"],
  ["address_extra", "Complément d'adresse"],
  ["postal_code", "Code postal"],
  ["city", "Ville"],
  ["phone", "Téléphone"],
  ["mobile", "Mobile"],
  ["email", "Email"],
] as const;

const VEHICLE_FIELDS = [
  ["plate", "Immatriculation"],
  ["vin", "VIN"],
  ["brand", "Marque"],
  ["model", "Modèle"],
  ["last_mileage", "Kilométrage"],
  ["first_registration", "1re mise en circulation"],
] as const;

const ORDER_FIELDS = [
  ["or_number", "N° OR"],
  ["or_date", "Date OR"],
  ["client_remarks", "Remarque client"],
  ["requested_work", "Travaux à effectuer"],
] as const;

const s = (v: unknown) => (v == null ? "" : String(v));

export function InfoEditForm({
  order,
  onDone,
  onCancel,
}: {
  order: Row;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { user, displayName } = useAuth();
  const client = (order["client"] ?? null) as Row | null;
  const vehicle = (order["vehicle"] ?? null) as Row | null;

  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {};
    for (const [k] of CLIENT_FIELDS) f[`c_${k}`] = s(client?.[k]);
    for (const [k] of VEHICLE_FIELDS) f[`v_${k}`] = s(vehicle?.[k]);
    for (const [k] of ORDER_FIELDS) f[`o_${k}`] = s(order[k]);
    return f;
  });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const emailWarn = form["c_email"] ? !isValidEmail(form["c_email"]) : false;

  async function save() {
    setSaving(true);
    try {
      const author = { userId: user?.id ?? null, userName: displayName || null };

      // CLIENT (créé si absent et qu'un nom est saisi)
      const clientPayload: Row = {};
      for (const [k] of CLIENT_FIELDS) clientPayload[k] = form[`c_${k}`]?.trim() || null;
      let clientId = s(client?.["id"]) || null;
      if (clientId) {
        const { error } = await supabase.from("clients").update(clientPayload).eq("id", clientId);
        if (error) throw error;
        await logChanges({
          entity: "client",
          entityId: clientId,
          before: (client ?? {}) as Row,
          after: clientPayload,
          ...author,
        });
      } else if (clientPayload["last_name"] || clientPayload["first_name"]) {
        const { data, error } = await supabase.from("clients").insert(clientPayload).select("id").single();
        if (error) throw error;
        clientId = data.id;
      }

      // VÉHICULE
      const vehicleId = s(vehicle?.["id"]);
      if (vehicleId) {
        const plate = form["v_plate"]?.trim().toUpperCase() ?? "";
        const mileageRaw = (form["v_last_mileage"] ?? "").replace(/\D/g, "");
        const vehiclePayload: Row = {
          plate: plate || s(vehicle?.["plate"]),
          plate_normalized: normalizePlate(plate || s(vehicle?.["plate"])),
          vin: form["v_vin"]?.trim() || null,
          brand: form["v_brand"]?.trim() || null,
          model: form["v_model"]?.trim() || null,
          first_registration: form["v_first_registration"] || null,
          ...(clientId ? { client_id: clientId } : {}),
        };
        const previousMileage = vehicle?.["last_mileage"] as number | null;
        if (mileageRaw && Number(mileageRaw) !== previousMileage) {
          vehiclePayload["last_mileage"] = Number(mileageRaw);
          vehiclePayload["last_mileage_at"] = new Date().toISOString();
          await supabase.from("mileage_history").insert({
            vehicle_id: vehicleId,
            mileage: Number(mileageRaw),
            source: "correction",
          });
        }
        const { error } = await supabase.from("vehicles").update(vehiclePayload).eq("id", vehicleId);
        if (error) throw error;
        await logChanges({
          entity: "vehicle",
          entityId: vehicleId,
          before: (vehicle ?? {}) as Row,
          after: vehiclePayload,
          ...author,
        });
      }

      // ORDRE DE RÉPARATION
      const orderPayload: Row = {
        or_number: form["o_or_number"]?.trim() || null,
        or_date: form["o_or_date"] || null,
        client_remarks: form["o_client_remarks"]?.trim() || null,
        requested_work: form["o_requested_work"]?.trim() || null,
        ...(clientId ? { client_id: clientId } : {}),
      };
      const orderId = s(order["id"]);
      const { error: oErr } = await supabase.from("repair_orders").update(orderPayload).eq("id", orderId);
      if (oErr) throw oErr;
      await logChanges({
        entity: "repair_order",
        entityId: orderId,
        before: order,
        after: orderPayload,
        ...author,
      });

      toast.success("Informations mises à jour");
      onDone();
    } catch (e) {
      console.error(e);
      toast.error("Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Section title="Client">
        {CLIENT_FIELDS.map(([k, label]) => (
          <Field
            key={k}
            label={label}
            value={form[`c_${k}`] ?? ""}
            onChange={(v) => set(`c_${k}`, v)}
            {...(k === "email" ? { type: "email" as const } : {})}
            {...(k === "email" && emailWarn ? { warn: "Adresse email probablement invalide" } : {})}
          />
        ))}
      </Section>

      <Section title="Véhicule">
        {VEHICLE_FIELDS.map(([k, label]) => (
          <Field
            key={k}
            label={label}
            value={form[`v_${k}`] ?? ""}
            onChange={(v) => set(`v_${k}`, k === "plate" ? v.toUpperCase() : v)}
            {...(k === "first_registration" ? { type: "date" as const } : {})}
            {...(k === "last_mileage" ? { type: "tel" as const } : {})}
          />
        ))}
      </Section>

      <Section title="Ordre de réparation">
        {ORDER_FIELDS.map(([k, label]) => (
          <Field
            key={k}
            label={label}
            value={form[`o_${k}`] ?? ""}
            onChange={(v) => set(`o_${k}`, v)}
            {...(k === "or_date" ? { type: "date" as const } : {})}
            {...(k === "client_remarks" || k === "requested_work" ? { textarea: true } : {})}
          />
        ))}
      </Section>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-bold uppercase"
        >
          Annuler
        </button>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Enregistrer
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-surface space-y-3 p-4">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  textarea,
  warn,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
  warn?: string;
}) {
  const id = `e-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const cls = `w-full rounded-lg border-2 bg-card px-3 py-3 text-base outline-none focus:border-brand ${
    warn ? "border-status-watch" : "border-border"
  }`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-muted-foreground">
        {label}
        {warn ? <span className="ml-2 text-status-watch">{warn}</span> : null}
      </label>
      {textarea ? (
        <textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </div>
  );
}
