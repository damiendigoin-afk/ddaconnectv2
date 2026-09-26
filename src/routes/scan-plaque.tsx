import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Camera, Car, Images, Loader2, Search } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { IxellioVehicleLookup } from "@/components/IxellioVehicleLookup";

import { supabase } from "@/integrations/supabase/client";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { compressImage, blobToDataUrl } from "@/lib/photo";
import { ocrPlate } from "@/lib/ocr.functions";
import { OR_SELECT } from "@/lib/queries";
import { customerName, findRefVehicleByPlate, vehicleLabel, type RefCustomer, type RefVehicle } from "@/lib/refbase";

export const Route = createFileRoute("/scan-plaque")({
  head: () => ({
    meta: [
      { title: "Scanner une plaque — DDA Connect" },
      {
        name: "description",
        content: "Identifiez un véhicule en photographiant sa plaque d'immatriculation.",
      },
      { property: "og:title", content: "Scanner une plaque — DDA Connect" },
      { property: "og:description", content: "Identification rapide d'un véhicule à l'atelier." },
    ],
  }),
  component: ScanPlate,
});

type OrRow = { id: string; or_number: string | null; or_date: string | null; vehicle: unknown };

function ScanPlate() {
  const navigate = useNavigate();
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [results, setResults] = useState<OrRow[] | null>(null);
  const [refVehicle, setRefVehicle] = useState<(RefVehicle & { customer: RefCustomer | null }) | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function analyse(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const blob = await compressImage(file, 1400, 0.85);
      const dataUrl = await blobToDataUrl(blob);
      const res = await ocrPlate({ data: { dataUrl } });
      if (res.ok) {
        setPlate(formatPlate(res.plate));
        await search(res.plate);
      } else {
        setNote(`${res.error} Saisissez la plaque manuellement.`);
      }
    } catch (e) {
      console.error(e);
      setNote("Analyse impossible. Saisissez la plaque manuellement.");
    } finally {
      setBusy(false);
    }
  }

  async function search(value: string) {
    // N° d'OR WinMotor (chiffres uniquement) : ouverture directe du dossier OR.
    const raw = value.trim();
    if (/^\d{3,}$/.test(raw)) {
      const { data: ors } = await supabase.from("repair_orders").select("id").eq("or_number", raw).limit(2);
      if (ors?.length === 1) {
        navigate({ to: "/or/$orId", params: { orId: ors[0]!.id } });
        return;
      }
      setNote(ors?.length ? "Plusieurs dossiers portent ce numéro d'OR : utilisez la recherche de l'accueil." : "Aucun OR WinMotor connu avec ce numéro.");
      return;
    }
    const norm = normalizePlate(value);
    if (!norm) return;
    setRefVehicle(await findRefVehicleByPlate(norm));
    const { data } = await supabase
      .from("repair_orders")
      .select(OR_SELECT)
      .order("created_at", { ascending: false });
    const matches = (data ?? []).filter(
      (o) => (o.vehicle as { plate_normalized?: string } | null)?.plate_normalized === norm,
    );
    // V3 : un scan de plaque n'ouvre ni ne crée d'OR — les OR connus sont proposés au choix.
    setResults(matches as OrRow[]);
  }

  return (
    <AppShell title="Scanner OR / plaque" back={{ to: "/atelier" }}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand px-3 py-4 text-sm font-bold uppercase text-brand-foreground"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            Photographier
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-4 text-sm font-bold uppercase"
          >
            <Images className="h-5 w-5" /> Galerie
          </button>
        </div>
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
          ref={galleryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void analyse(f);
          }}
        />

        {note ? (
          <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-sm text-foreground">{note}</p>
        ) : null}

        <div className="card-surface space-y-3 p-4">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Immatriculation ou n° OR WinMotor
          </label>
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder="AB-123-CD ou n° OR"
            className="plate-badge w-full rounded-lg border-2 border-border px-3 py-3 text-2xl uppercase outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={() => void search(plate)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-3 font-bold uppercase text-primary-foreground"
          >
            <Search className="h-4 w-4" /> Rechercher
          </button>
        </div>

        {refVehicle ? (
          <Link
            to="/vehicule/$vehId"
            params={{ vehId: refVehicle.id }}
            className="flex items-center gap-3 rounded-xl border-2 border-status-ok bg-card p-4"
          >
            <Car className="h-6 w-6 shrink-0 text-status-ok" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase text-status-ok">Véhicule trouvé</div>
              <div className="plate-badge text-xl">{refVehicle.registration_display ?? ""}</div>
              <div className="truncate text-xs text-muted-foreground">
                {vehicleLabel(refVehicle)}
                {refVehicle.customer ? ` · ${customerName(refVehicle.customer)}` : ""}
                {refVehicle.last_mileage ? ` · ${refVehicle.last_mileage.toLocaleString("fr-FR")} km` : ""}
              </div>
            </div>
          </Link>
        ) : null}

        {refVehicle ? (
          <div className="grid grid-cols-2 gap-2">
            <Link
              to="/tour-vehicule"
              search={{ vehicle_id: refVehicle.id }}
              className="rounded-xl bg-brand px-3 py-4 text-center text-sm font-bold uppercase text-brand-foreground"
            >
              Tour véhicule
            </Link>
            <Link
              to="/expertise/nouvelle"
              search={{ vehicle_id: refVehicle.id }}
              className="rounded-xl border-2 border-border bg-card px-3 py-4 text-center text-sm font-bold uppercase"
            >
              Expertise
            </Link>
          </div>
        ) : null}

        {results !== null && !refVehicle ? (
          <IxellioVehicleLookup
            plate={plate}
            onSaved={(vehId) => navigate({ to: "/vehicule/$vehId", params: { vehId } })}
          />
        ) : null}

        {results !== null ? (

          results.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Dossiers connus pour cette plaque
              </h2>
              {results.map((o) => {
                const v = o.vehicle as { plate?: string; brand?: string; model?: string } | null;
                return (
                  <button
                    key={o.id}
                    onClick={() => navigate({ to: "/or/$orId", params: { orId: o.id } })}
                    className="card-surface block w-full p-4 text-left"
                  >
                    <div className="plate-badge text-xl">{formatPlate(v?.plate ?? "")}</div>
                    <div className="text-sm text-muted-foreground">
                      {o.or_number ? `OR WinMotor ${o.or_number}` : "Dossier DDA — en attente OR WinMotor"} ·{" "}
                      {o.or_date ? new Date(o.or_date).toLocaleDateString("fr-FR") : "—"}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="card-surface space-y-3 p-4">
              <p className="text-sm font-medium">Aucun dossier connu pour cette plaque.</p>
              <p className="text-sm text-muted-foreground">
                Corrigez l'immatriculation ci-dessus, ou ouvrez un dossier DDA (le numéro d’OR viendra de WinMotor).
              </p>
              <button
                onClick={() => navigate({ to: "/or/nouveau", search: { plate } })}
                className="w-full rounded-lg bg-brand px-3 py-3 font-bold uppercase text-brand-foreground"
              >
                Ouvrir un dossier DDA (en attente OR)
              </button>
            </div>
          )
        ) : null}
      </div>
    </AppShell>
  );
}