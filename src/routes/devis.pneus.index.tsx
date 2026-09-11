/**
 * Devis pneus manuel — saisie rapide au comptoir.
 *
 * Le chiffrage est celui du Tour Véhicule : mêmes marques préférées, mêmes
 * marges, même consultation CentralePneus, mêmes forfaits de montage. Cette
 * page ne fait que saisir une dimension et afficher/archiver le résultat.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, History, Loader2, Printer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { MarginLever } from "@/components/MarginLever";
import { TireQuoteSheet } from "@/components/TireQuoteSheet";
import { adjustOffersMargin } from "@/lib/tires";
import { useAuth } from "@/lib/auth";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { prepareCapture } from "@/lib/photo-capture";
import { useSite } from "@/lib/site-context";
import { suggestBrands } from "@/lib/tire-brands";
import { analyzeTireLabelPhoto, analyzeWheelPhotos } from "@/lib/tire-ai.functions";
import { buildTireQuotePdf, openPdfBlob } from "@/lib/tire-quote-pdf";

import {
  EMPTY_TIRE_QUOTE_FORM,
  fetchTireEngine,
  formFromReference,
  quoteManualTires,
  quoteOffers,
  saveTireQuote,
  updateTireQuoteOffers,
  sizeFromForm,
  type ManualQuoteResult,
  type TireQuoteForm,
} from "@/lib/tire-quotes";
import type { TireLabelAi, TireWheelAi } from "@/lib/tire-types";

export const Route = createFileRoute("/devis/pneus/")({
  head: () => ({
    meta: [
      { title: "Devis pneus — DDA Connect" },
      {
        name: "description",
        content:
          "Saisie rapide d'une dimension pneumatique et chiffrage immédiat : six offres de gamme et marque demandée.",
      },
      { property: "og:title", content: "Devis pneus — DDA Connect" },
      {
        property: "og:description",
        content: "Chiffrage pneumatique au comptoir, imprimable en une page.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TireQuotePage,
});

type Shot = "dimension" | "marque" | "etiquette";

const SHOTS: { key: Shot; title: string; hint: string; optional: boolean }[] = [
  {
    key: "dimension",
    title: "Photo 1 — flanc du pneu",
    hint: "Cadrez la dimension complète (ex. 205/55 R16 91V)",
    optional: false,
  },
  {
    key: "marque",
    title: "Photo 2 — marque et modèle",
    hint: "Facultatif : le flanc où figurent la marque et le modèle",
    optional: true,
  },
  {
    key: "etiquette",
    title: "Photo 3 — étiquette du véhicule",
    hint: "Facultatif : beaucoup de véhicules n'en ont pas",
    optional: true,
  },
];

function TireQuotePage() {
  const { user, displayName } = useAuth();
  const { site, label: siteLabel } = useSite();

  const [form, setForm] = useState<TireQuoteForm>(EMPTY_TIRE_QUOTE_FORM);
  const [result, setResult] = useState<ManualQuoteResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [adjust, setAdjust] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const navigate = Route.useNavigate();
  /** Garde-fou anti-doublon : une seule création par chiffrage affiché. */
  const creatingRef = useRef<ManualQuoteResult | null>(null);


  // Passage de focus au fil de la saisie (largeur → hauteur → diamètre → charge → vitesse).
  const heightRef = useRef<HTMLInputElement>(null);
  const diameterRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  const speedRef = useRef<HTMLInputElement>(null);

  const engine = useQuery({ queryKey: ["tire-engine"], queryFn: fetchTireEngine, staleTime: 60_000 });


  const set = (patch: Partial<TireQuoteForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setResult(null);
    setSavedId(null);
    setAdjust(0);
  };

  const size = sizeFromForm(form);

  const quote = useMutation({
    mutationFn: async () => {
      if (!size) throw new Error("Dimension incomplète : largeur, série et diamètre sont nécessaires.");
      const data = engine.data ?? (await fetchTireEngine());
      return quoteManualTires({
        size,
        load: form.load.trim() || null,
        speed: form.speed.trim().toUpperCase() || null,
        requestedBrand: form.brand.trim() || null,
        quantity: form.quantity,
        engine: data,
      });
    },
    onSuccess: (r) => {
      setResult(r);
      setSavedId(null);
      setAdjust(0);
      if (r.warning) toast.warning(r.warning);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Chiffrage impossible"),
  });

  /** Validation du formulaire : bouton « Chiffrer » et touche Entrée. */
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!size || quote.isPending) return;
    quote.mutate();
  }

  /** Prix affichés : offres standard du moteur partagé + levier de marge. */
  const offers = useMemo(
    () => (result ? adjustOffersMargin(quoteOffers(result), adjust) : []),
    [result, adjust],
  );

  /* Enregistrement automatique : création unique, puis mise à jour de la même
     ligne à chaque mouvement du levier (petit délai anti-rafale). */
  useEffect(() => {
    if (!result || !size || savedId || creatingRef.current === result) return;
    creatingRef.current = result;
    void saveTireQuote({
      form,
      size,
      offers,
      siteId: site?.id ?? null,
      siteLabel,
      userId: user?.id ?? null,
      userName: displayName ?? "",
      marginAdjustmentPct: adjust,
    })
      .then((id) => setSavedId(id))
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : "Enregistrement automatique impossible"),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, size, savedId]);

  useEffect(() => {
    if (!savedId || !result) return undefined;
    const t = window.setTimeout(() => {
      void updateTireQuoteOffers({ id: savedId, offers, marginAdjustmentPct: adjust }).catch(() => {
        /* la mise à jour repartira au prochain mouvement */
      });
    }, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedId, adjust]);


  /** Impression : le devis est déjà auto-enregistré, on ouvre le PDF A4. */
  const [printing, setPrinting] = useState(false);
  async function openPdf() {
    if (!result || !size) return;
    setPrinting(true);
    try {
      const blob = await buildTireQuotePdf(
        {
          site: site ?? null,
          siteLabel,
          createdAt: new Date().toISOString(),
          userName: displayName ?? null,
          size: result.size,
          quantity: result.quantity,
          requestedBrand: result.requestedBrand,
          customerName: form.customerName.trim() || null,
          plate: form.plate.trim().toUpperCase() || null,
          vehicleLabel: form.vehicleLabel.trim() || null,
          loadIndex: form.load.trim() || null,
          speedIndex: form.speed.trim().toUpperCase() || null,
        },
        offers,
      );
      openPdfBlob(blob, `devis-pneus-${result.size.replace(/\W+/g, "-")}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Impression impossible");
    } finally {
      setPrinting(false);
    }
  }


  return (
    <AppShell
      title="Devis pneus"
      subtitle={siteLabel}
      back={{ to: "/" }}
      right={
        offers.length ? (
          <button
            onClick={() => void openPdf()}
            aria-label="Imprimer le devis"
            className="rounded-lg border border-border p-2 text-muted-foreground print:hidden"
          >
            <Printer className="h-4 w-4" />
          </button>
        ) : null
      }
    >
      <div className="space-y-4">
        <form onSubmit={submit} className="card-surface space-y-3 p-4 print:hidden">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold uppercase tracking-wide">Dimension</h2>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="flex items-center gap-2 rounded-lg border-2 border-border bg-card px-3 py-2 text-xs font-bold uppercase"
            >
              <Camera className="h-4 w-4 text-brand" /> Photo
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Field
              label="Largeur"
              value={form.width}
              onChange={(v) => {
                const n = v.replace(/\D/g, "").slice(0, 3);
                set({ width: n });
                if (n.length === 3 && form.width.length < 3) heightRef.current?.focus();
              }}
              placeholder="205"
              inputMode="numeric"
            />
            <Field
              inputRef={heightRef}
              label="Hauteur"
              value={form.height}
              onChange={(v) => {
                const n = v.replace(/\D/g, "").slice(0, 2);
                set({ height: n });
                if (n.length === 2 && form.height.length < 2) diameterRef.current?.focus();
              }}
              placeholder="55"
              inputMode="numeric"
            />
            <Field
              inputRef={diameterRef}
              label="Diamètre"
              value={form.diameter}
              onChange={(v) => {
                const n = v.replace(/\D/g, "").slice(0, 2);
                set({ diameter: n });
                if (n.length === 2 && form.diameter.length < 2) loadRef.current?.focus();
              }}
              placeholder="16"
              inputMode="numeric"
            />
            <Field
              inputRef={loadRef}
              label="Charge"
              value={form.load}
              onChange={(v) => {
                const n = v.replace(/\D/g, "").slice(0, 3);
                set({ load: n });
                // Certains indices comportent 3 caractères : on n'avance jamais à 2.
                if (n.length === 3 && form.load.length < 3) speedRef.current?.focus();
              }}
              placeholder="91"
              inputMode="numeric"
            />
            <Field
              inputRef={speedRef}
              label="Vitesse"
              value={form.speed}
              onChange={(v) => set({ speed: v.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) })}
              placeholder="V"
            />

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Quantité</span>
              <select
                value={form.quantity}
                onChange={(e) => set({ quantity: Number(e.target.value) })}
                className="h-12 w-full rounded-lg border-2 border-border bg-card px-2 text-base font-bold"
              >
                {[1, 2, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <BrandField value={form.brand} onChange={(v) => set({ brand: v })} />

          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-xs font-bold uppercase text-muted-foreground">
              Client / véhicule (facultatif)
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="Client" value={form.customerName} onChange={(v) => set({ customerName: v })} placeholder="Nom" />
              <Field label="Immatriculation" value={form.plate} onChange={(v) => set({ plate: v.toUpperCase() })} placeholder="AA-123-BB" />
              <Field label="Véhicule" value={form.vehicleLabel} onChange={(v) => set({ vehicleLabel: v })} placeholder="Clio V" />
            </div>
          </details>

          <button
            type="submit"
            disabled={!size || quote.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-5 text-base font-extrabold uppercase tracking-wide text-brand-foreground disabled:opacity-50"
          >
            {quote.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
            {form.brand.trim() ? "Chiffrer (7 offres)" : "Chiffrer (6 offres)"}
          </button>
          {!size ? (
            <p className="text-xs text-muted-foreground">
              Renseignez largeur, série et diamètre (ex. 205 / 55 / 16) ou prenez une photo du flanc.
            </p>
          ) : null}
        </form>

        {result ? (
          <>
            <MarginLever value={adjust} onChange={setAdjust} />

            <TireQuoteSheet
              header={{
                site,
                siteLabel,
                createdAt: new Date().toISOString(),
                userName: displayName ?? null,
                size: result.size,
                quantity: result.quantity,
                requestedBrand: result.requestedBrand,
                customerName: form.customerName.trim() || null,
                plate: form.plate.trim() || null,
                vehicleLabel: form.vehicleLabel.trim() || null,
                loadIndex: form.load.trim() || null,
                speedIndex: form.speed.trim().toUpperCase() || null,
              }}
              offers={offers}
            />

            <button
              type="button"
              disabled={printing}
              onClick={() => void openPdf()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50 print:hidden"
            >
              {printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
              Imprimer le devis
            </button>
            <p className="text-center text-xs text-muted-foreground print:hidden">
              {savedId ? "Devis enregistré automatiquement dans l'historique." : "Enregistrement en cours…"}
            </p>
          </>
        ) : null}

        <Link
          to="/devis/pneus/historique"
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-extrabold uppercase print:hidden"
        >
          <History className="h-5 w-5 text-brand" /> Historique des devis
        </Link>
      </div>

      {cameraOpen ? (
        <TirePhotoFlow
          onClose={() => setCameraOpen(false)}
          onFields={(patch) => set(patch)}
          onFinish={() => setCameraOpen(false)}
        />
      ) : null}
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric";
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ""}
        {...(inputMode ? { inputMode } : {})}
        className="h-12 w-full rounded-lg border-2 border-border bg-card px-3 text-base font-bold"
      />
    </label>
  );
}


/** Autocomplétion de marque : aide à la saisie, jamais imposée. */
function BrandField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = suggestBrands(value);
  return (
    <div className="relative">
      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase text-muted-foreground">
          Marque souhaitée (facultatif)
        </span>
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Michelin, Kleber…"
          className="h-12 w-full rounded-lg border-2 border-border bg-card px-3 text-base font-bold"
        />
      </label>
      {open && options.length ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border-2 border-border bg-card shadow-lg">
          {options.map((b) => (
            <li key={b}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(b);
                  setOpen(false);
                }}
                className="block w-full px-3 py-3 text-left text-sm font-semibold"
              >
                {b}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Parcours photo court : flanc (dimension), marque/modèle, étiquette véhicule.
 * Aucune étape n'est bloquante : « Passer » reste toujours disponible et un
 * échec de lecture laisse la saisie manuelle intacte.
 */
function TirePhotoFlow({
  onClose,
  onFields,
  onFinish,
}: {
  onClose: () => void;
  onFields: (patch: Partial<TireQuoteForm>) => void;
  onFinish: () => void;
}) {
  const analyzeWheel = useServerFn(analyzeWheelPhotos);
  const analyzeLabel = useServerFn(analyzeTireLabelPhoto);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const step = SHOTS[index]!;

  function next() {
    if (index + 1 >= SHOTS.length) onFinish();
    else setIndex(index + 1);
  }

  async function handleFile(input: unknown) {
    const capture = prepareCapture(input);
    if (!capture) {
      toast.error("Photo non récupérée par l'appareil. Reprenez la photo ou saisissez la dimension.");
      return;
    }
    setBusy(true);
    try {
      const reduced = await compressImage(capture.blob, 1600, 0.8).catch(() => capture.blob);
      const dataUrl = await blobToDataUrl(reduced);
      if (step.key === "etiquette") {
        const res = await analyzeLabel({ data: { images: [dataUrl] } });
        const label = res.ok && res.json ? (JSON.parse(res.json) as TireLabelAi) : null;
        if (label?.size_front) {
          onFields(
            formFromReference({
              size: label.size_front,
              load_index: label.load_index_front,
              speed_index: label.speed_index_front,
            }),
          );
          toast.success("Étiquette lue — vérifiez les valeurs");
        } else {
          toast.warning("Étiquette non exploitable — saisie manuelle possible");
        }
      } else {
        const res = await analyzeWheel({ data: { images: [dataUrl] } });
        const ai = res.ok && res.json ? (JSON.parse(res.json) as TireWheelAi) : null;
        if (!ai) {
          toast.warning("Lecture impossible — saisissez la dimension manuellement");
        } else if (step.key === "dimension") {
          const patch = formFromReference(ai);
          if (patch.width) {
            onFields(patch);
            toast.success("Dimension lue — vérifiez les valeurs");
          } else {
            toast.warning("Dimension illisible — saisie manuelle");
          }
        } else if (ai.brand) {
          onFields({ brand: ai.brand });
          toast.success(`Marque lue : ${ai.brand}`);
        } else {
          toast.warning("Marque illisible — saisie manuelle");
        }
      }
    } catch {
      toast.error("Lecture photo indisponible — poursuivez la saisie manuellement");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      next();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 print:hidden">
      <div className="w-full space-y-3 rounded-t-2xl bg-card p-4">
        <div className="text-sm font-extrabold uppercase tracking-wide">{step.title}</div>
        <p className="text-xs text-muted-foreground">{step.hint}</p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-5 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          {busy ? "Lecture en cours…" : "Prendre la photo"}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={next}
            className="rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-extrabold uppercase"
          >
            Passer
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-extrabold uppercase"
          >
            Fermer
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Étape {index + 1} / {SHOTS.length}
          {step.optional ? " — facultative" : ""}. Toutes les valeurs restent modifiables à la main.
        </p>
      </div>
    </div>
  );
}
