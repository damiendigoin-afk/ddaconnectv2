/**
 * Encart réutilisable : proposé lorsqu'une immatriculation est absente de la base.
 * Interroge IXELLIO côté serveur puis propose l'enregistrement du véhicule.
 */
import { useServerFn } from "@tanstack/react-start";
import { Car, Loader2, Search } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { lookupIxellioVehicle, saveIxellioVehicle } from "@/lib/ixellio.functions";
import { cachedIxellioLookup } from "@/lib/ixellio-lookup-cache";
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
  variant = "default",
  renderSaved,
}: {
  plate: string;
  onSaved?: (vehicleId: string) => void;
  /** "home" : libellés accueil (« Véhicule non trouvé dans DDA Connect », « Rechercher avec Ixellio »). */
  variant?: "default" | "home";
  /** Actions proposées après enregistrement confirmé (ex. Tour véhicule / OR). */
  renderSaved?: (vehicleId: string) => ReactNode;
}) {
  const home = variant === "home";
  const lookup = useServerFn(lookupIxellioVehicle);
  const save = useServerFn(saveIxellioVehicle);
  const [state, setState] = useState<"ask" | "loading" | "done" | "declined">("ask");
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [diag, setDiag] = useState<{ fields: string[]; count: number; versionList: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ fields: number; id: string } | null>(null);
  // Garde synchrone : aucun double clic / requête concurrente (l'état React arrive trop tard).
  const busy = useRef(false);

  const norm = normalizePlate(plate);
  if (norm.length < 4) return null;

  async function ask(force = false) {
    if (busy.current) return;
    busy.current = true;
    setState("loading");
    setMessage("");
    try {
      const res = await cachedIxellioLookup(norm, (p) => lookup({ data: { plate: p } }), { force });
      setVehicle(res.ok ? res.vehicle : null);
      setDiag({
        fields: res.detectedFields ?? [],
        count: res.fieldCount ?? 0,
        versionList: Boolean(res.isVersionList),
      });
      setMessage(res.message);
      setState("done");
    } catch (e) {
      setVehicle(null);
      setDiag(null);
      setMessage(e instanceof Error ? e.message : "Interrogation IXELLIO impossible.");
      setState("done");
    } finally {
      busy.current = false;
    }
  }

  async function persist() {
    if (!vehicle || busy.current || saved) return;
    busy.current = true;
    setSaving(true);
    try {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(vehicle)) if (v) clean[k] = v;
      const res = await save({ data: { plate: norm, vehicle: clean } });
      setSaved({ fields: res.storedFields, id: res.id });
      onSaved?.(res.id);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
      busy.current = false;
    }
  }

  if (state === "declined") return null;

  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Car className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold uppercase">
            {home ? "Véhicule non trouvé dans DDA Connect" : "Véhicule inconnu"}
          </p>
          <p className="text-xs text-muted-foreground">
            {home
              ? `${formatPlate(norm)} n'est pas encore enregistré. Ixellio peut fournir les informations du véhicule.`
              : `${formatPlate(norm)} n'est pas dans la base DDA Connect. Interroger IXELLIO pour récupérer les informations du véhicule ?`}
          </p>
        </div>
      </div>

      {state === "ask" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void ask()}
            className="rounded-lg bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground"
          >
            {home ? "Rechercher avec Ixellio" : "Oui, interroger IXELLIO"}
          </button>
          <button
            type="button"
            onClick={() => setState("declined")}
            className="rounded-lg border-2 border-border px-3 py-3 text-xs font-extrabold uppercase"
          >
            {home ? "Ignorer" : "Non"}
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
            onClick={() => void ask(true)}
            className="flex items-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
          >
            <Search className="h-3.5 w-3.5" /> Réessayer
          </button>
        </div>
      ) : null}

      {state === "done" && vehicle ? (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">
            {diag?.count ?? 0} champ(s) récupéré(s)
            {diag?.fields.length ? ` : ${diag.fields.join(", ")}` : ""}
          </p>
          {diag && diag.versionList ? (
            <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-xs font-bold">
              IXELLIO propose plusieurs versions pour cette immatriculation : aucune variante n'a été
              choisie automatiquement.
            </p>
          ) : null}
          {diag && diag.count > 0 && diag.count <= 1 ? (
            <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-xs font-bold">
              IXELLIO a répondu mais l'extraction des détails est incomplète (seul le VIN a été
              identifié).
            </p>
          ) : null}
          <p className="text-sm font-extrabold">{formatPlate(norm)}</p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-lg bg-muted px-3 py-2 text-xs">
            {FIELDS.filter(([k]) => vehicle[k]).map(([k, label]) => (
              <div key={k}>
                <dt className="text-[10px] font-bold uppercase text-muted-foreground">{label}</dt>
                <dd className="break-words font-semibold">{vehicle[k]}</dd>
              </div>
            ))}
          </dl>
          {saved ? (
            <>
              <p className="rounded-lg bg-status-ok-soft px-3 py-2 text-xs font-bold">
                Véhicule enregistré dans DDA Connect ({saved.fields} champs mémorisés et vérifiés).
              </p>
              {renderSaved ? renderSaved(saved.id) : null}
            </>
          ) : (
            <button
              type="button"
              onClick={() => void persist()}
              disabled={saving}
              className="w-full rounded-lg bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              {saving ? "Enregistrement…" : "Enregistrer ce véhicule dans DDA Connect"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
