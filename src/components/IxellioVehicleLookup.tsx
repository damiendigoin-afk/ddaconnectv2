/**
 * Encart réutilisable : proposé lorsqu'une immatriculation est absente de la base.
 * Interroge IXELLIO côté serveur puis propose l'enregistrement du véhicule.
 */
import { useServerFn } from "@tanstack/react-start";
import { Car, Loader2, Search } from "lucide-react";
import { useState } from "react";

import { lookupIxellioVehicle, saveIxellioVehicle } from "@/lib/ixellio.functions";
import { formatPlate, normalizePlate } from "@/lib/plate";

type Vehicle = Record<string, string | undefined>;

const FIELDS: [string, string][] = [
  ["marque", "Marque"],
  ["modele", "Modèle"],
  ["version", "Version"],
  ["vin", "VIN"],
  ["cnit", "CNIT"],
  ["typeMine", "Type Mine"],
  ["tvv", "TVV"],
  ["codeMoteur", "Code moteur"],
  ["cylindree", "Cylindrée"],
  ["carburant", "Carburant"],
  ["boite", "Boîte de vitesses"],
  ["codeBoite", "Code boîte"],
  ["dateMec", "1re mise en circulation"],
  ["puissanceFiscale", "Puissance fiscale (CV)"],
  ["puissanceCh", "Puissance (ch)"],
  ["puissanceKw", "Puissance (kW)"],
  ["portes", "Portes"],
  ["places", "Places"],
  ["carrosserie", "Carrosserie"],
  ["genre", "Genre"],
  ["couleur", "Couleur"],
  ["poids", "Poids"],
  ["ptac", "PTAC"],
  ["masseVide", "Masse à vide"],
  ["co2", "CO2"],
];


export function IxellioVehicleLookup({
  plate,
  onSaved,
}: {
  plate: string;
  onSaved?: (vehicleId: string) => void;
}) {
  const lookup = useServerFn(lookupIxellioVehicle);
  const save = useServerFn(saveIxellioVehicle);
  const [state, setState] = useState<"ask" | "loading" | "done" | "declined">("ask");
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ fields: number } | null>(null);

  const norm = normalizePlate(plate);
  if (norm.length < 4) return null;

  async function ask() {
    setState("loading");
    setMessage("");
    try {
      const res = await lookup({ data: { plate: norm } });
      setVehicle(res.ok ? res.vehicle : null);
      setMessage(res.message);
      setState("done");
    } catch (e) {
      setVehicle(null);
      setMessage(e instanceof Error ? e.message : "Interrogation IXELLIO impossible.");
      setState("done");
    }
  }

  async function persist() {
    if (!vehicle) return;
    setSaving(true);
    try {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(vehicle)) if (v) clean[k] = v;
      const res = await save({ data: { plate: norm, vehicle: clean } });
      setSaved({ fields: res.storedFields });
      onSaved?.(res.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "declined") return null;

  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Car className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold uppercase">Véhicule inconnu</p>
          <p className="text-xs text-muted-foreground">
            {formatPlate(norm)} n'est pas dans la base DDA Connect. Interroger IXELLIO pour récupérer les
            informations du véhicule ?
          </p>
        </div>
      </div>

      {state === "ask" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void ask()}
            className="rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground"
          >
            Oui, interroger IXELLIO
          </button>
          <button
            type="button"
            onClick={() => setState("declined")}
            className="rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
          >
            Non
          </button>
        </div>
      ) : null}

      {state === "loading" ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Interrogation IXELLIO en cours…
        </p>
      ) : null}

      {state === "done" && !vehicle ? (
        <div className="mt-3 space-y-2">
          <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-xs">{message}</p>
          <button
            type="button"
            onClick={() => void ask()}
            className="flex items-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
          >
            <Search className="h-3.5 w-3.5" /> Réessayer
          </button>
        </div>
      ) : null}

      {state === "done" && vehicle ? (
        <div className="mt-3 space-y-3">
          <dl className="grid grid-cols-2 gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
            {FIELDS.filter(([k]) => vehicle[k]).map(([k, label]) => (
              <div key={k}>
                <dt className="text-[10px] font-bold uppercase text-muted-foreground">{label}</dt>
                <dd className="font-semibold">{vehicle[k]}</dd>
              </div>
            ))}
          </dl>
          {saved ? (
            <p className="rounded-lg bg-status-ok-soft px-3 py-2 text-xs font-bold">
              Véhicule enregistré dans DDA Connect ({saved.fields} champs mémorisés et vérifiés).
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void persist()}
              disabled={saving}
              className="w-full rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              {saving ? "Enregistrement…" : "Enregistrer ce véhicule dans DDA Connect"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
