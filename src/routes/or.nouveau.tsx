import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, FileText, Images, Loader2, PencilLine } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { IxellioVehicleLookup } from "@/components/IxellioVehicleLookup";
import { supabase } from "@/integrations/supabase/client";
import { isValidEmail } from "@/lib/validation";
import { normalizePlate } from "@/lib/plate";
import { findDuplicateOrder } from "@/lib/queries";
import { nextInternalRef } from "@/lib/or-ref";
import { upsertRef } from "@/lib/external-refs";

import { refPrefill, type RefPrefill } from "@/lib/refbase";
import { blobToDataUrl, compressImage, uploadPhoto } from "@/lib/photo";
import { ocrRepairOrder } from "@/lib/ocr.functions";

export const Route = createFileRoute("/or/nouveau")({
  validateSearch: (search: Record<string, unknown>) => ({
    plate: typeof search["plate"] === "string" ? (search["plate"] as string) : "",
  }),
  head: () => ({
    meta: [
      { title: "Nouvelle intervention — DDA Connect" },
      {
        name: "description",
        content: "Créez une intervention DDA en photographiant un document ou par saisie manuelle.",
      },
      { property: "og:title", content: "Nouvelle intervention — DDA Connect" },
      { property: "og:description", content: "Scan OCR d'un OR WinMotor ou saisie manuelle rapide." },
    ],
  }),
  component: NewOrder,
});

type Form = {
  account_number: string;
  last_name: string;
  first_name: string;
  address: string;
  address_extra: string;
  postal_code: string;
  city: string;
  phone: string;
  mobile: string;
  email: string;
  plate: string;
  vin: string;
  brand: string;
  model: string;
  mileage: string;
  first_registration: string;
  or_number: string;
  or_date: string;
  client_remarks: string;
  requested_work: string;
  entry_at: string;
  delivery_at: string;
};

const EMPTY: Form = {
  account_number: "",
  last_name: "",
  first_name: "",
  address: "",
  address_extra: "",
  postal_code: "",
  city: "",
  phone: "",
  mobile: "",
  email: "",
  plate: "",
  vin: "",
  brand: "",
  model: "",
  mileage: "",
  first_registration: "",
  or_number: "",
  or_date: new Date().toISOString().slice(0, 10),
  client_remarks: "",
  requested_work: "",
  entry_at: "",
  delivery_at: "",
};

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

function NewOrder() {
  const navigate = useNavigate();
  const { plate: initialPlate } = Route.useSearch();
  const [mode, setMode] = useState<"choice" | "form">(initialPlate ? "form" : "choice");
  const [form, setForm] = useState<Form>({ ...EMPTY, plate: initialPlate });
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docFile, setDocFile] = useState<File | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [refHit, setRefHit] = useState<RefPrefill | null>(null);
  const [unknownPlate, setUnknownPlate] = useState("");


  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const flagged = (path: string) => uncertain.includes(path);

  /** Recherche le véhicule dans le référentiel et complète les champs vides. */
  async function applyRef(plate: string) {
    if (!normalizePlate(plate)) return;
    try {
      const hit = await refPrefill(plate);
      if (!hit) {
        setRefHit(null);
        setUnknownPlate(normalizePlate(plate));
        return;
      }
      setUnknownPlate("");
      setRefHit(hit);
      setForm((f) => {
        const next = { ...f };
        for (const [k, v] of Object.entries(hit.fields)) {
          if (v && !next[k as keyof Form]) next[k as keyof Form] = v;
        }
        return next;
      });

    } catch (e) {
      console.error(e);
    }
  }

  useEffect(() => {
    if (initialPlate) void applyRef(initialPlate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlate]);

  async function analyse(file: File) {
    setBusy(true);
    try {
      const isPdf = file.type === "application/pdf";
      const blob = isPdf ? file : await compressImage(file, 1800, 0.9);
      const dataUrl = await blobToDataUrl(blob);
      setDocFile(isPdf ? null : new File([blob], "or.jpg", { type: "image/jpeg" }));
      const res = await ocrRepairOrder({ data: { dataUrl, filename: file.name } });
      if (!res.ok) {
        toast.error(`${res.error} Complétez manuellement.`);
        setMode("form");
        return;
      }
      const parsed = JSON.parse(res.json) as Record<string, Record<string, unknown>> & {
        uncertain?: string[];
      };
      const c = parsed["client"] ?? {};
      const v = parsed["vehicle"] ?? {};
      const o = parsed["order"] ?? {};
      setForm({
        account_number: str(c["account_number"]),
        last_name: str(c["last_name"]),
        first_name: str(c["first_name"]),
        address: str(c["address"]),
        address_extra: str(c["address_extra"]),
        postal_code: str(c["postal_code"]),
        city: str(c["city"]),
        phone: str(c["phone"]),
        mobile: str(c["mobile"]),
        email: str(c["email"]),
        plate: str(v["plate"]),
        vin: str(v["vin"]),
        brand: str(v["brand"]),
        model: str(v["model"]),
        mileage: str(v["mileage"]).replace(/\D/g, ""),
        first_registration: str(v["first_registration"]).slice(0, 10),
        or_number: str(o["or_number"]),
        or_date: str(o["or_date"]).slice(0, 10) || EMPTY.or_date,
        client_remarks: str(o["client_remarks"]),
        requested_work: str(o["requested_work"]),
        entry_at: str(o["entry_at"]).slice(0, 16),
        delivery_at: str(o["delivery_at"]).slice(0, 16),
      });
      setUncertain(Array.isArray(parsed.uncertain) ? parsed.uncertain : []);
      setMode("form");
      toast.success("Vérifiez les informations détectées");
      await applyRef(str(v["plate"]));
    } catch (e) {
      console.error(e);
      toast.error("Analyse impossible. Complétez manuellement.");
      setMode("form");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!form.plate.trim()) {
      toast.error("L'immatriculation est obligatoire");
      return;
    }
    // §33 — le n° d'OR WinMotor est facultatif : il peut ne pas exister à l'accueil.

    if (!form.last_name.trim()) {
      toast.error("Le nom du client est obligatoire");
      return;
    }
    if (form.email.trim() && !isValidEmail(form.email)) {
      const ok = window.confirm(
        `L'adresse email « ${form.email} » semble incorrecte. Créer l'intervention quand même ?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      // Anti-doublon : un même n° OR WinMotor sur la même immatriculation existe déjà.
      const dup = await findDuplicateOrder(form.or_number, form.plate);
      if (dup.exact) {
        toast.error("Cet OR WinMotor est déjà rattaché à une intervention — ouverture de la fiche existante.");
        navigate({ to: "/or/$orId", params: { orId: dup.exact.id } });
        return;
      }
      if (dup.sameNumber.length > 0) {
        const ok = window.confirm(
          `Le n° OR WinMotor ${form.or_number} est déjà utilisé pour ${dup.sameNumber
            .map((o) => o.plate)
            .join(", ")}. Créer quand même une intervention pour ${form.plate.toUpperCase()} ?`,
        );
        if (!ok) return;
      }
      let clientId: string | null = null;
      if (form.last_name || form.first_name || form.account_number) {
        const { data, error } = await supabase
          .from("clients")
          .insert({
            account_number: form.account_number || null,
            last_name: form.last_name || null,
            first_name: form.first_name || null,
            address: form.address || null,
            address_extra: form.address_extra || null,
            postal_code: form.postal_code || null,
            city: form.city || null,
            phone: form.phone || null,
            mobile: form.mobile || null,
            email: form.email || null,
          })
          .select()
          .single();
        if (error) throw error;
        clientId = data.id;
      }

      const norm = normalizePlate(form.plate);
      const mileage = form.mileage ? parseInt(form.mileage, 10) : null;
      const existing = await supabase
        .from("vehicles")
        .select("id")
        .eq("plate_normalized", norm)
        .maybeSingle();

      let vehicleId: string;
      if (existing.data) {
        vehicleId = existing.data.id;
        await supabase
          .from("vehicles")
          .update({
            client_id: clientId,
            vin: form.vin || null,
            brand: form.brand || null,
            model: form.model || null,
            ...(mileage ? { last_mileage: mileage, last_mileage_at: new Date().toISOString() } : {}),
          })
          .eq("id", vehicleId);
      } else {
        const { data, error } = await supabase
          .from("vehicles")
          .insert({
            client_id: clientId,
            plate: form.plate.toUpperCase(),
            plate_normalized: norm,
            vin: form.vin || null,
            brand: form.brand || null,
            model: form.model || null,
            first_registration: form.first_registration || null,
            last_mileage: mileage,
            last_mileage_at: mileage ? new Date().toISOString() : null,
          })
          .select()
          .single();
        if (error) throw error;
        vehicleId = data.id;
      }

      // Toute intervention DDA possède sa référence interne ; l'OR WinMotor n'est
      // qu'une référence externe optionnelle, jamais générée par DDA.
      const hasOrNumber = !!form.or_number.trim();
      const internalRef = await nextInternalRef();

      const { data: order, error: orErr } = await supabase
        .from("repair_orders")
        .insert({
          vehicle_id: vehicleId,
          client_id: clientId,
          or_number: form.or_number.trim() || null,
          internal_ref: internalRef,
          record_type: hasOrNumber ? "or_winmotor" : "intervention",
          or_status: hasOrNumber ? "or_complet" : "sans_or",
          or_source: hasOrNumber ? "saisie_manuelle" : null,
          or_linked_at: hasOrNumber ? new Date().toISOString() : null,

          or_date: form.or_date || null,
          client_remarks: form.client_remarks || null,
          requested_work: form.requested_work || null,
          entry_at: form.entry_at ? new Date(form.entry_at).toISOString() : null,
          delivery_at: form.delivery_at ? new Date(form.delivery_at).toISOString() : null,
          mileage_in: mileage,
        })
        .select()
        .single();
      if (orErr) throw orErr;

      if (hasOrNumber) {
        // Mémorisation de la correspondance externe : l'OR WinMotor est un
        // identifiant du DMS, conservé pour les imports suivants.
        try {
          await upsertRef({
            entityType: "order",
            entityId: order.id,
            externalId: form.or_number,
            status: "confirmed",
            criteria: ["winmotor_or_number"],
          });
        } catch (e) {
          console.error(e);
        }
      }

      if (docFile) {
        try {
          await uploadPhoto(docFile, `orders/${order.id}`, {
            repair_order_id: order.id,
            label: "Document OR",
          });
        } catch (e) {
          console.error(e);
        }
      }

      if (mileage) {
        await supabase
          .from("mileage_history")
          .insert({ vehicle_id: vehicleId, mileage, source: "ordre_reparation" });
      }

      toast.success("Intervention créée");
      navigate({ to: "/or/$orId", params: { orId: order.id } });
    } catch (e) {
      console.error(e);
      toast.error("Création impossible");
    } finally {
      setSaving(false);
    }
  }

  if (mode === "choice") {
    return (
      <AppShell title="Nouvelle intervention" back={{ to: "/tour-vehicule" }}>
        <div className="space-y-3">
          <button
            onClick={() => cameraRef.current?.click()}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-5 text-left font-bold uppercase text-brand-foreground"
          >
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            <span>
              Photographier l'OR WinMotor
              <span className="block text-xs font-medium normal-case opacity-80">
                Analyse automatique du document
              </span>
            </span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-5 text-left font-bold uppercase"
          >
            <FileText className="h-6 w-6" />
            <span>
              Importer photo ou PDF
              <span className="block text-xs font-medium normal-case text-muted-foreground">
                Depuis la galerie ou les fichiers
              </span>
            </span>
          </button>
          <button
            onClick={() => setMode("form")}
            className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card px-4 py-5 text-left font-bold uppercase"
          >
            <PencilLine className="h-6 w-6" />
            <span>
              Saisie manuelle
              <span className="block text-xs font-medium normal-case text-muted-foreground">
                Sans analyse du document
              </span>
            </span>
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void analyse(f);
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void analyse(f);
            }}
          />
          {busy ? (
            <p className="text-center text-sm text-muted-foreground">Analyse du document en cours…</p>
          ) : null}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Vérifier les informations" subtitle="Tous les champs sont modifiables" back={{ to: "/tour-vehicule" }}>
      <div className="space-y-4 pb-4">
        {!refHit && unknownPlate ? (
          <IxellioVehicleLookup plate={unknownPlate} onSaved={() => void applyRef(unknownPlate)} />
        ) : null}
        {refHit ? (
          <div className="flex items-start gap-2 rounded-xl border-2 border-status-ok bg-card p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-ok" />
            <div className="min-w-0 flex-1">
              <p className="font-bold uppercase">Véhicule trouvé dans la base</p>
              <p className="truncate text-muted-foreground">{refHit.label}</p>
              <Link
                to="/vehicule/$vehId"
                params={{ vehId: refHit.vehicleId }}
                className="text-xs font-bold uppercase underline"
              >
                Ouvrir la fiche véhicule
              </Link>
            </div>
          </div>
        ) : null}
        <Section title="Véhicule">
          <Field label="Immatriculation" value={form.plate} onChange={(v) => set("plate", v.toUpperCase())} warn={flagged("vehicle.plate")} big />
          <Field label="VIN" value={form.vin} onChange={(v) => set("vin", v)} warn={flagged("vehicle.vin")} />
          <Field label="Marque" value={form.brand} onChange={(v) => set("brand", v)} warn={flagged("vehicle.brand")} />
          <Field label="Modèle / version" value={form.model} onChange={(v) => set("model", v)} warn={flagged("vehicle.model")} />
          <Field label="Kilométrage" value={form.mileage} onChange={(v) => set("mileage", v.replace(/\D/g, ""))} type="tel" warn={flagged("vehicle.mileage")} />
          <Field label="1re mise en circulation" value={form.first_registration} onChange={(v) => set("first_registration", v)} type="date" />
        </Section>

        <Section title="Intervention">
          <Field label="N° OR WinMotor (facultatif, jamais généré par DDA)" value={form.or_number} onChange={(v) => set("or_number", v)} warn={flagged("order.or_number")} />
          <p className="text-xs text-muted-foreground">
            Laissez vide si WinMotor n'a pas encore généré le numéro : une référence interne DDA est créée et le
            dossier reste « en attente du numéro d'OR ».
          </p>

          <Field label="Date OR" value={form.or_date} onChange={(v) => set("or_date", v)} type="date" />
          <Field label="Remarques client" value={form.client_remarks} onChange={(v) => set("client_remarks", v)} textarea />
          <Field label="Travaux à prévoir" value={form.requested_work} onChange={(v) => set("requested_work", v)} textarea />
          <Field label="Entrée" value={form.entry_at} onChange={(v) => set("entry_at", v)} type="datetime-local" />
          <Field label="Restitution" value={form.delivery_at} onChange={(v) => set("delivery_at", v)} type="datetime-local" />
        </Section>

        <Section title="Client">
          <Field label="N° compte client" value={form.account_number} onChange={(v) => set("account_number", v)} />
          <Field label="Nom" value={form.last_name} onChange={(v) => set("last_name", v)} warn={flagged("client.last_name")} />
          <Field label="Prénom" value={form.first_name} onChange={(v) => set("first_name", v)} />
          <Field label="Adresse" value={form.address} onChange={(v) => set("address", v)} />
          <Field label="Complément" value={form.address_extra} onChange={(v) => set("address_extra", v)} />
          <Field label="Code postal" value={form.postal_code} onChange={(v) => set("postal_code", v)} />
          <Field label="Ville" value={form.city} onChange={(v) => set("city", v)} />
          <Field label="Téléphone" value={form.phone} onChange={(v) => set("phone", v)} type="tel" />
          <Field label="Mobile" value={form.mobile} onChange={(v) => set("mobile", v)} type="tel" />
          <Field label="Email" value={form.email} onChange={(v) => set("email", v)} type="email" />
        </Section>

        <button
          onClick={() => void submit()}
          disabled={saving}
          className="w-full rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase text-brand-foreground"
        >
          {saving ? "Création…" : "Valider et créer l'OR"}
        </button>
      </div>
    </AppShell>
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
  big,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
  warn?: boolean;
  big?: boolean;
}) {
  const cls = `w-full rounded-lg border-2 bg-card px-3 py-3 outline-none focus:border-brand ${
    warn ? "border-status-watch" : "border-border"
  } ${big ? "plate-badge text-xl uppercase" : "text-base"}`;
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-muted-foreground">
        {label}
        {warn ? <span className="ml-2 text-status-watch">à vérifier</span> : null}
      </label>
      {textarea ? (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={cls} />
      ) : (
        <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </div>
  );
}