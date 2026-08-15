import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { createExpertise, EXPERTISE_TYPES } from "@/lib/expertise";
import { supabase } from "@/integrations/supabase/client";
import { ocrPlate } from "@/lib/ocr.functions";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { formatPlate, normalizePlate } from "@/lib/plate";

export const Route = createFileRoute("/expertise/nouvelle")({
  head: () => ({
    meta: [
      { title: "Nouvelle expertise — DDA Connect" },
      {
        name: "description",
        content:
          "Démarrer une expertise véhicule : identification par plaque, scan de l'immatriculation ou saisie manuelle.",
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

function NewExpertise() {
  const navigate = useNavigate();
  const { user, displayName, profile } = useAuth();
  const [plate, setPlate] = useState("");
  const [type, setType] = useState<string>("reprise");
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
        setPlate(formatPlate(res.plate));
        toast.success(`Plaque détectée : ${formatPlate(res.plate)}`);
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

  async function start() {
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
        expertise_type: type,
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

  return (
    <AppShell title="Nouvelle expertise" subtitle="Identification du véhicule" back={{ to: "/expertises" }}>
      <div className="space-y-4">
        <section className="card-surface space-y-3 p-4">
          <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Immatriculation
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="AB-123-CD"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-3 text-xl font-extrabold tracking-widest text-foreground"
            />
          </label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={scanning}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-3 text-sm font-bold uppercase"
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
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

        <section className="card-surface p-4">
          <h2 className="pb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Type d'expertise
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {EXPERTISE_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setType(t.key)}
                className={`rounded-lg border-2 px-3 py-3 text-sm font-bold ${
                  type === t.key ? "border-brand bg-brand/10" : "border-border bg-card"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <button
          onClick={() => void start()}
          disabled={busy}
          className="w-full rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
        >
          {busy ? "Création…" : "Démarrer l'expertise"}
        </button>
      </div>
    </AppShell>
  );
}