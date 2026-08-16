import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { EntitySearch, type EntityPick } from "@/components/EntitySearch";
import { useAuth } from "@/lib/auth";
import { createExpertise } from "@/lib/expertise";
import { supabase } from "@/integrations/supabase/client";
import { ocrPlate } from "@/lib/ocr.functions";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { refPrefill } from "@/lib/refbase";

export const Route = createFileRoute("/expertise/nouvelle")({
  head: () => ({
    meta: [
      { title: "Nouvelle expertise — DDA Connect" },
      {
        name: "description",
        content:
          "Démarrer une expertise véhicule : recherche client/véhicule, scan de l'immatriculation ou saisie manuelle.",
      },
      { property: "og:title", content: "Nouvelle expertise — DDA Connect" },
      {
        property: "og:description",
        content: "Identification du véhicule et démarrage de l'expertise.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewExpertise,
});

async function findVehicleLink(plateNormalized: string, vin: string) {
  if (plateNormalized) {
    const { data } = await supabase
      .from("vehicles")
      .select("id, client_id")
      .eq("plate_normalized", plateNormalized)
      .maybeSingle();
    if (data) return data;
  }
  if (vin) {
    const { data } = await supabase.from("vehicles").select("id, client_id").eq("vin", vin).maybeSingle();
    if (data) return data;
  }
  return null;
}

function NewExpertise() {
  const navigate = useNavigate();
  const { user, displayName, profile } = useAuth();
  const [manual, setManual] = useState(false);
  const [plate, setPlate] = useState("");
  const [pick, setPick] = useState<EntityPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function scan(file: File) {
    setScanning(true);
    try {
      const blob = await compressImage(file, 1400, 0.8);
      const dataUrl = await blobToDataUrl(blob);
      const res = await ocrPlate({ data: { dataUrl, filename: file.name } });
      if (res.ok) {
        const formatted = formatPlate(res.plate);
        toast.success(`Plaque détectée : ${formatted}`);
        if (manual) {
          setPlate(formatted);
        } else {
          const prefill = await refPrefill(res.plate);
          if (prefill) {
            setPick(prefill);
            toast.success("Véhicule reconnu, informations pré-remplies.");
          } else {
            setManual(true);
            setPlate(formatted);
          }
        }
      } else {
        toast.error(res.error);
      }
    } catch (e) {
      console.error(e);
      toast.error("Lecture de la plaque impossible.");
    } finally {
      setScanning(false);
    }
  }

  async function startFromPick(p: EntityPick) {
    setBusy(true);
    try {
      const normalized = normalizePlate(p.fields.plate ?? "");
      const link = await findVehicleLink(normalized, p.fields.vin ?? "");
      const owner = [p.fields.first_name, p.fields.last_name].filter(Boolean).join(" ").trim();
      const exp = await createExpertise({
        expertise_type: "expertise",
        plate: p.fields.plate ? formatPlate(p.fields.plate) : null,
        vehicle_id: link?.id ?? null,
        client_id: link?.client_id ?? p.customerId ?? null,
        vin: p.fields.vin || null,
        brand: p.fields.brand || null,
        model: p.fields.model || null,
        first_registration: p.fields.first_registration || null,
        mileage: p.fields.mileage ? Number(p.fields.mileage) : null,
        owner_name: owner || null,
        site_id: profile?.site_id ?? null,
        created_by: user?.id ?? null,
        created_by_name: displayName || null,
      });
      await navigate({ to: "/expertise/$exId", params: { exId: exp.id } });
    } catch (e) {
      console.error(e);
      toast.error("Impossible de démarrer l'expertise.");
    } finally {
      setBusy(false);
    }
  }

  async function startManual() {
    const normalized = normalizePlate(plate);
    if (normalized.length < 5) {
      toast.error("Immatriculation requise.");
      return;
    }
    setBusy(true);
    try {
      const { data: vehicle } = await supabase
        .from("vehicles")
        .select("id, client_id, plate, vin, brand, model, first_registration, last_mileage")
        .eq("plate_normalized", normalized)
        .maybeSingle();

      const exp = await createExpertise({
        expertise_type: "expertise",
        plate: formatPlate(normalized),
        vehicle_id: vehicle?.id ?? null,
        client_id: vehicle?.client_id ?? null,
        vin: vehicle?.vin ?? null,
        brand: vehicle?.brand ?? null,
        model: vehicle?.model ?? null,
        first_registration: vehicle?.first_registration ?? null,
        mileage: vehicle?.last_mileage ?? null,
        site_id: profile?.site_id ?? null,
        created_by: user?.id ?? null,
        created_by_name: displayName || null,
      });
      if (vehicle) toast.success("Véhicule reconnu, informations pré-remplies.");
      await navigate({ to: "/expertise/$exId", params: { exId: exp.id } });
    } catch (e) {
      console.error(e);
      toast.error("Impossible de démarrer l'expertise.");
    } finally {
      setBusy(false);
    }
  }

  if (manual) {
    return (
      <AppShell title="Nouvelle expertise" subtitle="Saisie manuelle" back={{ to: "/expertise/nouvelle" }}>
        <div className="space-y-4">
          <section className="card-surface space-y-3 p-4">
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Immatriculation
              <input
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                placeholder="AB-123-CD"
                autoComplete="off"
                autoFocus
                className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-xl font-extrabold tracking-widest text-foreground"
              />
            </label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Scanner la plaque
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void scan(f);
                e.target.value = "";
              }}
            />
          </section>
          <button
            onClick={() => void startManual()}
            disabled={busy}
            className="w-full rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
          >
            {busy ? "Création…" : "Démarrer l'expertise"}
          </button>
          <button
            type="button"
            onClick={() => setManual(false)}
            className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-sm font-bold uppercase"
          >
            Revenir à la recherche
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Nouvelle expertise" subtitle="Identification du véhicule" back={{ to: "/expertises" }}>
      <div className="space-y-4">
        <EntitySearch
          label="Client ou véhicule"
          placeholder="Immat, nom, téléphone, VIN, n° OR…"
          onPick={(p) => setPick(p)}
          onCreateNew={(term) => {
            setManual(true);
            const normalized = normalizePlate(term);
            setPlate(normalized.length >= 5 ? formatPlate(normalized) : term.toUpperCase());
          }}
          onScan={(file) => void scan(file)}
          scanning={scanning}
          autoFocus
        />

        {pick ? (
          <section className="card-surface space-y-2 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Sélection</p>
            <p className="text-base font-extrabold">{pick.label}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {pick.fields.vin ? <p>VIN : {pick.fields.vin}</p> : null}
              {pick.fields.mobile || pick.fields.phone ? (
                <p>Tél : {pick.fields.mobile || pick.fields.phone}</p>
              ) : null}
              {pick.fields.email ? <p>Email : {pick.fields.email}</p> : null}
              {pick.fields.mileage ? <p>Kilométrage : {pick.fields.mileage} km</p> : null}
              {pick.fields.first_registration ? <p>1re immat. : {pick.fields.first_registration}</p> : null}
            </div>
            <button
              onClick={() => void startFromPick(pick)}
              disabled={busy}
              className="mt-2 w-full rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              {busy ? "Création…" : "Démarrer l'expertise"}
            </button>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
