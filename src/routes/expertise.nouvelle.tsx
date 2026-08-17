import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { EntitySearch, type EntityPick } from "@/components/EntitySearch";
import { useAuth } from "@/lib/auth";
import { explainError, toastError, type Explained } from "@/lib/errors";
import { findOpenExpertise, missingInfo, startExpertise } from "@/lib/expertise-start";
import { ocrPlate } from "@/lib/ocr.functions";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { formatPlate, normalizePlate } from "@/lib/plate";
import { refPrefill, refPrefillByVehicle } from "@/lib/refbase";

export const Route = createFileRoute("/expertise/nouvelle")({
  validateSearch: (search: Record<string, unknown>): { vehicle_id?: string } =>
    typeof search["vehicle_id"] === "string" && search["vehicle_id"]
      ? { vehicle_id: search["vehicle_id"] as string }
      : {},
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

function NewExpertise() {
  const navigate = useNavigate();
  const { vehicle_id: vehicleIdParam } = Route.useSearch();
  const { user, displayName, profile } = useAuth();
  const [manual, setManual] = useState(false);
  const [plate, setPlate] = useState("");
  const [pick, setPick] = useState<EntityPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [problem, setProblem] = useState<Explained | null>(null);
  const [existing, setExisting] = useState<{ id: string; plate: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Contexte véhicule transmis depuis une fiche véhicule / client : rien à ressaisir.
  useEffect(() => {
    if (!vehicleIdParam) return;
    let alive = true;
    refPrefillByVehicle(vehicleIdParam)
      .then((p) => {
        if (!alive) return;
        if (p) setPick(p);
        else
          setProblem({
            what: "Véhicule introuvable",
            why: "Le véhicule transmis n'existe plus dans le référentiel.",
            how: "Recherchez le véhicule ci-dessous ou créez-le.",
          });
      })
      .catch((e) => alive && setProblem(explainError(e, "Véhicule non chargé")));
    return () => {
      alive = false;
    };
  }, [vehicleIdParam]);

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

  const ctx = { siteId: profile?.site_id ?? null, userId: user?.id ?? null, userName: displayName };

  async function start(input: { prefill?: EntityPick | null; plate?: string }) {
    setBusy(true);
    setProblem(null);
    setExisting(null);
    try {
      const open = await findOpenExpertise({
        refVehicleId: input.prefill?.vehicleId ?? null,
        plate: input.plate ? formatPlate(normalizePlate(input.plate)) : (input.prefill?.fields["plate"] ?? null),
      });
      if (open) {
        setExisting({ id: open.id as string, plate: (open.plate as string | null) ?? null });
        setBusy(false);
        return;
      }
      await create(input);
    } catch (e) {
      setProblem(toastError(e, "Impossible de démarrer l'expertise"));
      setBusy(false);
    }
  }

  async function create(input: { prefill?: EntityPick | null; plate?: string }) {
    setBusy(true);
    try {
      const exp = await startExpertise(input, ctx);
      const missing = missingInfo(input.prefill ?? null);
      toast.success(
        missing.length
          ? `Expertise créée — ${missing.length} information(s) à compléter : ${missing.join(", ")}.`
          : "Expertise créée.",
      );
      await navigate({ to: "/expertise/$exId", params: { exId: exp.id } });
    } catch (e) {
      setProblem(toastError(e, "Impossible de démarrer l'expertise"));
    } finally {
      setBusy(false);
    }
  }

  async function startManual() {
    const normalized = normalizePlate(plate);
    if (normalized.length < 5) {
      setProblem({
        what: "Immatriculation incomplète",
        why: "Une immatriculation valide comporte au moins 5 caractères.",
        how: "Corrigez l'immatriculation ou scannez la plaque.",
      });
      return;
    }
    const prefill = await refPrefill(normalized).catch(() => null);
    await start(prefill ? { prefill } : { plate: normalized });
  }

  if (manual) {
    return (
      <AppShell title="Nouvelle expertise" subtitle="Saisie manuelle" back={{ to: "/expertise/nouvelle" }}>
        <div className="space-y-4">
          <Problem problem={problem} />
          <Existing existing={existing} onNew={() => void create({ plate })} />
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
        <Problem problem={problem} />
        <Existing existing={existing} onNew={() => void create({ prefill: pick })} />

        {pick ? null : (
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
        )}

        {pick ? (
          <section className="card-surface space-y-2 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Véhicule sélectionné</p>
            <p className="text-base font-extrabold">{pick.label}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {pick.fields['vin'] ? <p>VIN : {pick.fields['vin']}</p> : null}
              {pick.fields['mobile'] || pick.fields['phone'] ? (
                <p>Tél : {pick.fields['mobile'] || pick.fields['phone']}</p>
              ) : null}
              {pick.fields['email'] ? <p>Email : {pick.fields['email']}</p> : null}
              {pick.fields['mileage'] ? <p>Kilométrage : {pick.fields['mileage']} km</p> : null}
              {pick.fields['first_registration'] ? <p>1re immat. : {pick.fields['first_registration']}</p> : null}
            </div>
            <button
              onClick={() => void start({ prefill: pick })}
              disabled={busy}
              className="mt-2 w-full rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              {busy ? "Création…" : "Démarrer l'expertise"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPick(null);
                setExisting(null);
                setProblem(null);
              }}
              className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-sm font-bold uppercase"
            >
              Changer de véhicule
            </button>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

/** Message d'erreur explicite : ce qui bloque, pourquoi, comment corriger. */
export function Problem({ problem }: { problem: Explained | null }) {
  if (!problem) return null;
  return (
    <section className="rounded-xl border-2 border-destructive/60 bg-destructive/10 p-4">
      <p className="flex items-center gap-2 text-sm font-extrabold uppercase text-destructive">
        <AlertTriangle className="h-4 w-4" /> {problem.what}
      </p>
      <p className="mt-1 text-sm">{problem.why}</p>
      <p className="mt-1 text-sm font-bold">→ {problem.how}</p>
    </section>
  );
}

function Existing({
  existing,
  onNew,
}: {
  existing: { id: string; plate: string | null } | null;
  onNew: () => void;
}) {
  if (!existing) return null;
  return (
    <section className="card-surface space-y-2 p-4">
      <p className="text-sm font-extrabold uppercase">Une expertise est déjà ouverte pour ce véhicule</p>
      <p className="text-sm text-muted-foreground">{existing.plate ?? "—"}</p>
      <Link
        to="/expertise/$exId"
        params={{ exId: existing.id }}
        className="block w-full rounded-xl bg-brand px-4 py-3 text-center text-sm font-extrabold uppercase text-brand-foreground"
      >
        Ouvrir l'expertise existante
      </Link>
      <button
        type="button"
        onClick={onNew}
        className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-sm font-bold uppercase"
      >
        Créer une nouvelle expertise
      </button>
    </section>
  );
}
