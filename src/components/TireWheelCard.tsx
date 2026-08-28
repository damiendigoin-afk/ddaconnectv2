/**
 * Contrôle pneumatique d'une roue, intégré au Tour Véhicule.
 *
 * Deux photos guidées (roue complète puis bande de roulement), analyse visuelle
 * OpenAI, application de la grille d'usure administrable et du niveau de
 * sévérité global, validation ou correction humaine mémorisée, puis préparation
 * automatique des sept propositions tarifaires.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, ChevronDown, ChevronUp, ImagePlus, Loader2, PencilLine, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { PhotoManager } from "@/components/PhotoManager";
import { StatusPicker, type PointStatus } from "@/components/StatusPicker";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { blobToDataUrl, compressImage, uploadPhoto } from "@/lib/photo";
import type { CommercialSettings, ServicePackage } from "@/lib/pricing-engine";
import { analyzeWheelPhotos } from "@/lib/tire-ai.functions";
import { fetchPublicTireOffers } from "@/lib/tire-provider.functions";
import type { TireWheelAi } from "@/lib/tire-types";
import {
  GRADE_LABEL,
  SEASON_LABEL,
  TIER_LABEL,
  axleOf,
  buildSevenOffers,
  fetchBrandTiers,
  gradeToPriority,
  publicItemsToOffers,
  sizeConfidenceMessage,
  type PublicTireItem,
  judgeTire,
  needsQuote,
  parseTireReference,
  severityOf,
  wearGrid,
  type SevenOffer,
  type TireGrade,
  type TireOffer,
  type TireSeason,
} from "@/lib/tires";
import type { PointRow } from "@/components/PointCard";

const STEPS = [
  {
    key: "bande",
    label: "Bande de roulement",
    mask: "tread" as const,
    hint: "Placez la bande de roulement dans le U et montrez le maximum de largeur visible",
  },
  {
    key: "flanc",
    label: "Flanc complet et roue entière",
    mask: "sidewall" as const,
    hint: "Si possible, placez la dimension dans la zone indiquée",
  },
];


const MOTIFS = [
  "Trop sévère",
  "Trop permissif",
  "Profondeur incorrecte",
  "Caractéristique incorrecte",
  "Anomalie mal interprétée",
  "Photo insuffisante",
  "Autre",
];

const EMPTY: TireWheelAi = {
  brand: null,
  model: null,
  size: null,
  load_index: null,
  speed_index: null,
  season: null,
  dot: null,
  depth_mm: null,
  depth_kind: null,
  wear: null,
  wear_zone: null,
  cracks: false,
  cuts: false,
  bulges: false,
  foreign_objects: false,
  sidewall_damage: false,
  rim_damage: false,
  photo_quality: "bonne",
  confidence: {},
  observations: [],
  client_comment: null,
  unreadable: [],
  model_used: "",
};

type Stored = {
  ai: TireWheelAi | null;
  final: TireWheelAi | null;
  grade: TireGrade | null;
  reasons: string[];
  confirmed: boolean;
  partial: boolean;
  attempts: number;
  /** Empreinte des photos déjà analysées : évite tout appel IA redondant. */
  photoHash?: string | null;
  /** Référence pneumatique confirmée par l'opérateur (ex « 195/55 R16 87H »). */
  confirmedRef?: string | null;
};

function readStored(value: unknown): Stored {
  const v = (value ?? {}) as Partial<Stored>;
  return {
    ai: v.ai ?? null,
    final: v.final ?? null,
    grade: v.grade ?? null,
    reasons: v.reasons ?? [],
    confirmed: v.confirmed ?? false,
    partial: v.partial ?? false,
    attempts: v.attempts ?? 0,
    photoHash: v.photoHash ?? null,
    confirmedRef: v.confirmedRef ?? null,
  };
}

/** Empreinte locale et rapide d'un lot de photos (aucun coût, aucun réseau). */
function hashOf(parts: string[]): string {
  let h = 0;
  const joined = parts.join("|");
  for (let i = 0; i < joined.length; i += 1) {
    h = (h * 31 + joined.charCodeAt(i)) | 0;
  }
  return `${joined.length}:${h}`;
}

/** Construit « 195/55 R16 87H » à partir des éléments disponibles. */
function refString(size?: string | null, load?: string | null, speed?: string | null): string {
  const idx = `${load ?? ""}${speed ?? ""}`.trim();
  return [size ?? "", idx].filter(Boolean).join(" ").trim();
}


function euro(v: number | null | undefined) {
  return v == null ? "—" : `${v.toFixed(2)} €`;
}

export function TireWheelCard({
  point,
  inspectionId,
  vehicleId,
  requiredSize,
  requiredLoad,
  requiredSpeed,
}: {
  point: PointRow & { tire_analysis?: unknown };
  inspectionId: string;
  vehicleId?: string | null;
  requiredSize: string | null;
  requiredLoad: string | null;
  requiredSpeed: string | null;
}) {
  const { user, displayName } = useAuth();
  const analyze = useServerFn(analyzeWheelPhotos);

  const [stored, setStored] = useState<Stored>(() => readStored(point.tire_analysis));
  const [status, setStatus] = useState<PointStatus>(point.status as PointStatus);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [freeCamera, setFreeCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TireWheelAi>(EMPTY);
  const [draftGrade, setDraftGrade] = useState<TireGrade>("correct");
  const [motif, setMotif] = useState(MOTIFS[0]!);
  const [photoKey, setPhotoKey] = useState(0);
  const [showOthers, setShowOthers] = useState(false);
  const [quantity, setQuantity] = useState(2);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [refInput, setRefInput] = useState<string>("");
  const [refTouched, setRefTouched] = useState(false);

  const code = point.point_key.replace("pneu_", "");
  const axle = axleOf(code);
  const rearAxle = /ar/.test(code);

  const engine = useQuery({
    queryKey: ["tire-engine"],
    queryFn: async () => {
      const [settings, offers, packages, brands] = await Promise.all([
        supabase.from("commercial_settings").select("*").limit(1).maybeSingle(),
        supabase.from("tire_offers").select("*").eq("active", true),
        supabase.from("service_packages").select("*").eq("active", true),
        fetchBrandTiers(),
      ]);
      return {
        settings: (settings.data ?? null) as CommercialSettings | null,
        offers: (offers.data ?? []) as TireOffer[],
        packages: (packages.data ?? []) as ServicePackage[],
        brands,
      };
    },
  });

  // Dernière monte confirmée sur la fiche véhicule : proposée, jamais imposée.
  const fitment = useQuery({
    queryKey: ["vehicle-fitment", vehicleId],
    enabled: Boolean(vehicleId),
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("tire_size_front, tire_size_rear, homologated_tire_size")
        .eq("id", vehicleId as string)
        .maybeSingle();
      return (data ?? null) as {
        tire_size_front: string | null;
        tire_size_rear: string | null;
        homologated_tire_size: string | null;
      } | null;
    },
  });

  const publicOffers = useServerFn(fetchPublicTireOffers);

  const grid = wearGrid(engine.data?.settings ?? null);
  const severity = severityOf(engine.data?.settings ?? null);
  const result = stored.final ?? stored.ai;

  /* ------------------------- Référence pneumatique ------------------------- */

  // Proposition : correction déjà confirmée > lecture du flanc > étiquette
  // véhicule > dernière monte mémorisée. Aucune écrasement silencieux.
  const memorized = rearAxle
    ? (fitment.data?.tire_size_rear ?? fitment.data?.tire_size_front ?? null)
    : (fitment.data?.tire_size_front ?? null);
  const readRef =
    refString(result?.size, result?.load_index, result?.speed_index) ||
    refString(requiredSize, requiredLoad, requiredSpeed) ||
    memorized ||
    fitment.data?.homologated_tire_size ||
    "";
  const suggestion = stored.confirmedRef || readRef;
  const currentRef = refTouched ? refInput : suggestion;
  const parsedRef = parseTireReference(currentRef);
  // Le devis n'est débloqué que par une référence COMPLÈTE : dimension + charge + vitesse.
  const refConfirmed = parseTireReference(stored.confirmedRef).complete;
  const refState: "reconnue" | "partielle" | "introuvable" = parseTireReference(readRef).complete
    ? "reconnue"
    : parseTireReference(readRef).size
      ? "partielle"
      : "introuvable";

  const effectiveSize = refConfirmed ? parseTireReference(stored.confirmedRef).size : null;

  // Consultation publique réelle des prix TTC, refaite à chaque chiffrage/recalcul.
  const publicQuery = useQuery({
    queryKey: ["tire-public-offers", effectiveSize],
    enabled: Boolean(effectiveSize) && Boolean(stored.grade && needsQuote(stored.grade)),
    staleTime: 0,
    queryFn: () => publicOffers({ data: { size: effectiveSize as string } }),
  });


  async function persist(next: Stored, extra: Record<string, unknown> = {}) {
    setStored(next);
    await supabase
      .from("inspection_points")
      .update({
        tire_analysis: next as never,
        photo_quality: next.ai?.photo_quality ?? null,
        ai_confidence: next.ai?.confidence?.["depth_mm"] ?? null,
        client_comment: (next.final ?? next.ai)?.client_comment ?? null,
        updated_at: new Date().toISOString(),
        ...extra,
      })
      .eq("id", point.id);
  }

  function statusFor(grade: TireGrade): PointStatus {
    if (grade === "imperatif" || grade === "rapide") return "defect";
    if (grade === "a_prevoir") return "watch";
    return "ok";
  }

  /**
   * Rafale : les deux photos sont enregistrées puis analysées en arrière-plan.
   * Aucun écran bloquant, aucune reprise imposée : le Tour Véhicule continue.
   */
  function onShots(shots: BurstShot[], free: boolean) {
    setCameraOpen(false);
    setFreeCamera(false);
    if (!shots.length) return;
    void runAnalysis(shots, free);
  }

  async function runAnalysis(shots: BurstShot[], free: boolean) {
    setBusy(true);
    try {
      const dataUrls: string[] = [];
      for (const shot of shots) {
        await uploadPhoto(shot.blob, `inspections/${inspectionId}`, {
          inspection_id: inspectionId,
          inspection_point_id: point.id,
          label: shot.label,
        });
        const small = await compressImage(shot.blob, 1400, 0.8);
        dataUrls.push(await blobToDataUrl(small));
      }
      setPhotoKey((k) => k + 1);

      // Anti-doublon : photos inchangées = aucune nouvelle analyse payante.
      const hash = hashOf(dataUrls);
      if (hash === stored.photoHash && stored.ai) {
        setBusy(false);
        return;
      }

      const res = await analyze({ data: { images: dataUrls.slice(0, 5) } });
      if (!res.ok || !res.json) {
        toast.error(res.error || "Analyse indisponible — saisie manuelle possible.");
        await persist({ ...stored, partial: true, attempts: stored.attempts + 1, photoHash: hash });
        return;
      }
      const ai = JSON.parse(res.json) as TireWheelAi;
      const attempts = free ? stored.attempts : stored.attempts + 1;
      const partial = ai.photo_quality === "insuffisante";
      const judged = judgeTire(ai, grid, severity);
      const next: Stored = {
        ai,
        final: null,
        grade: judged.grade,
        reasons: judged.reasons,
        confirmed: false,
        partial,
        attempts,
        photoHash: hash,
        // Photos différentes = nouvelle lecture : l'ancienne confirmation est invalidée.
        confirmedRef: null,
      };
      const st = statusFor(judged.grade);
      setStatus(st);
      await persist(next, {
        status: st,
        measure_value: ai.depth_mm != null ? String(ai.depth_mm) : null,
        measure_unit: "mm",
        comment: partial ? "Analyse partielle : qualité des photos insuffisante" : point.comment,
      });
      if (partial) toast.warning("Analyse partielle — la dimension pourra être saisie au chiffrage");
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'analyse — saisie manuelle possible.");
    } finally {
      setBusy(false);
    }
  }

  /** Confirme la référence pneumatique et la mémorise sur la fiche véhicule. */
  async function confirmRef() {
    const parsed = parseTireReference(currentRef);
    if (!parsed.complete) {
      toast.error(
        parsed.size
          ? "Référence incomplète — ajoutez les indices de charge et de vitesse, ex : 195/55 R16 87H"
          : "Référence illisible — exemple attendu : 195/55 R16 87H",
      );
      return;
    }
    await persist({ ...stored, confirmedRef: parsed.display });
    setRefTouched(false);
    if (vehicleId) {
      const patch = rearAxle
        ? { tire_size_rear: parsed.display }
        : { tire_size_front: parsed.display };
      await supabase
        .from("vehicles")
        .update({ ...patch, tire_size_confirmed_at: new Date().toISOString() })
        .eq("id", vehicleId);
      void fitment.refetch();
    }
    toast.success(`Référence confirmée : ${parsed.display}`);
  }


  async function confirm() {
    if (!result || !stored.grade) return;
    const next: Stored = { ...stored, final: result, confirmed: true };
    await persist(next, { status: statusFor(stored.grade) });
    toast.success("Analyse confirmée");
  }

  function startEdit() {
    setDraft(result ?? EMPTY);
    setDraftGrade(stored.grade ?? "correct");
    setEditing(true);
  }

  async function saveEdit() {
    const judged = judgeTire(draft, grid, severity);
    const next: Stored = {
      ...stored,
      final: draft,
      grade: draftGrade,
      reasons: judged.reasons,
      confirmed: true,
    };
    const st = statusFor(draftGrade);
    setStatus(st);
    await persist(next, {
      status: st,
      measure_value: draft.depth_mm != null ? String(draft.depth_mm) : null,
      measure_unit: "mm",
    });

    // Mémorisation du refus / de la correction pour l'apprentissage futur.
    await supabase.from("ai_corrections").insert({
      module: "pneumatiques",
      subject: `analyse_pneu_${code}`,
      source_id: point.id,
      corrected: true,
      context: motif,
      ai_confidence: stored.ai?.confidence?.["depth_mm"] ?? null,
      ai_result: {
        analysis: stored.ai,
        grade: stored.grade,
        reasons: stored.reasons,
        model: stored.ai?.model_used ?? null,
        severity,
        grid,
      } as never,
      human_result: { analysis: draft, grade: draftGrade, motif } as never,
      final_result: { analysis: draft, grade: draftGrade } as never,
      user_id: user?.id ?? null,
      user_name: displayName || null,
    });

    setEditing(false);
    toast.success("Correction enregistrée");
  }

  /* ------------------------------ Propositions ----------------------------- */

  const offers: SevenOffer[] =
    engine.data && stored.grade && needsQuote(stored.grade) && refConfirmed
      ? buildSevenOffers({
          offers: [
            ...publicItemsToOffers(
              (publicQuery.data?.ok ? (publicQuery.data.items as PublicTireItem[]) : []),
              engine.data.brands,
            ),
            ...engine.data.offers,
          ],
          brands: engine.data.brands,
          packages: engine.data.packages,
          settings: engine.data.settings,
          quantity,
          mounted: {
            brand: result?.brand ?? null,
            model: result?.model ?? null,
            size: result?.size ?? null,
            season: (result?.season as TireSeason | null) ?? null,
          },
          required: {
            size: effectiveSize ?? requiredSize ?? result?.size ?? null,
            load: parsedRef.load ?? requiredLoad ?? result?.load_index ?? null,
            speed: parsedRef.speed ?? requiredSpeed ?? result?.speed_index ?? null,
          },
        })
      : [];


  async function selectOffer(offer: SevenOffer) {
    setSelectedSlot(offer.slot);
    await supabase.from("tire_quote_offers").delete().eq("inspection_point_id", point.id);
    await supabase.from("tire_quote_offers").insert(
      offers.map((o) => ({
        inspection_id: inspectionId,
        inspection_point_id: point.id,
        wheel_code: code,
        kind: o.kind,
        tier: o.tier,
        season: o.season,
        brand: o.brand,
        model: o.model,
        size: o.size,
        load_index: o.loadIndex,
        speed_index: o.speedIndex,
        quantity: o.quantity,
        supplier: o.supplier,
        supplier_ref: o.supplierRef,
        source_price_ht: o.unitSourceHt,
        source_price_ttc: o.unitSourceHt == null ? null : Math.round(o.unitSourceHt * 1.2 * 100) / 100,
        ...(o.consultedAt ? { consulted_at: o.consultedAt } : {}),
        margin_ht: o.marginHt,
        sell_price_ht: o.unitSellHt,
        mount_package: o.mountLabel,
        mount_total_ttc: o.mountTtc,
        total_ht: o.totalHt,
        total_vat: o.totalVat,
        total_ttc: o.totalTtc,
        availability: o.availability,
        compatibility: o.compatibilityMessage,
        selected: o.slot === offer.slot,
        initial_payload: o as never,
        final_payload: o.slot === offer.slot ? (o as never) : null,
      })),
    );
    toast.success("Offre retenue pour le devis");
  }

  const identical = offers[0];
  const others = offers.slice(1);

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold">{point.point_label}</h3>
        {stored.grade ? (
          <span className="text-xs font-bold uppercase text-muted-foreground">{GRADE_LABEL[stored.grade]}</span>
        ) : null}
      </div>

      <StatusPicker
        value={status}
        onChange={(v) => {
          setStatus(v);
          void supabase.from("inspection_points").update({ status: v }).eq("id", point.id);
        }}
      />

      <button
        type="button"
        onClick={() => setCameraOpen(true)}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        {busy ? "Analyse en cours…" : stored.ai ? "Reprendre les 2 photos" : "Photographier la roue (2 photos)"}
      </button>

      {stored.ai ? (
        <button
          type="button"
          onClick={() => {
            setFreeCamera(true);
            setCameraOpen(true);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase text-muted-foreground"
        >
          <ImagePlus className="h-4 w-4" /> Ajouter une photo pour affiner l'analyse +
        </button>
      ) : null}

      {stored.partial ? (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950">
          Analyse partielle : qualité des photos insuffisante.
        </p>
      ) : null}

      {result ? (
        <div className="space-y-2 rounded-xl border-2 border-border p-3">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Info label="Marque" value={result.brand} />
            <Info label="Modèle" value={result.model} />
            <Info label="Dimension" value={result.size} />
            <Info
              label="Indices"
              value={[result.load_index, result.speed_index].filter(Boolean).join(" ") || null}
            />
            <Info
              label="Saison"
              value={result.season ? (SEASON_LABEL[result.season as TireSeason] ?? result.season) : null}
            />
            <Info label="DOT" value={result.dot} />
            <Info
              label="Profondeur"
              value={
                result.depth_mm != null
                  ? `${result.depth_mm} mm (${result.depth_kind === "mesure" ? "mesure" : "estimation"})`
                  : null
              }
            />
            <Info label="Usure" value={result.wear === "irreguliere" ? `Irrégulière${result.wear_zone ? ` · ${result.wear_zone}` : ""}` : result.wear === "reguliere" ? "Régulière" : null} />
          </dl>

          {stored.reasons.length ? (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {stored.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}

          {result.unreadable.length ? (
            <p className="text-xs text-amber-700">Non lisible : {result.unreadable.join(", ")}</p>
          ) : null}

          {result.client_comment ? (
            <p className="rounded-lg bg-secondary px-3 py-2 text-xs">{result.client_comment}</p>
          ) : null}

          <p className="text-[11px] uppercase text-muted-foreground">
            Sévérité globale : {severity} · seuils {grid.good} / {grid.soon} / {grid.legal} mm
          </p>

          {editing ? (
            <EditForm
              draft={draft}
              setDraft={setDraft}
              grade={draftGrade}
              setGrade={setDraftGrade}
              motif={motif}
              setMotif={setMotif}
              onCancel={() => setEditing(false)}
              onSave={() => void saveEdit()}
            />
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void confirm()}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-status-ok px-3 py-3 text-xs font-extrabold uppercase text-white"
              >
                <Check className="h-4 w-4" /> {stored.confirmed ? "Confirmé" : "Confirmer"}
              </button>
              <button
                type="button"
                onClick={startEdit}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border-2 border-border px-3 py-3 text-xs font-extrabold uppercase"
              >
                <PencilLine className="h-4 w-4" /> Modifier
              </button>
            </div>
          )}
        </div>
      ) : null}

      {stored.grade && needsQuote(stored.grade) ? (
        <div className="space-y-2 rounded-xl border-2 border-brand/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-extrabold uppercase tracking-widest">
              Chiffrage — {axle.label} ({gradeToPriority(stored.grade)})
            </span>
            <label className="flex items-center gap-1 text-xs">
              Qté
              <input
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
                className="w-12 rounded-lg border-2 border-border px-2 py-1 text-center"
              />
            </label>
          </div>

          {/* Référence pneumatique : proposée, corrigeable, à confirmer. */}
          <div className="space-y-1 rounded-lg bg-secondary/50 p-2">
            <span className="text-[11px] font-extrabold uppercase tracking-widest">
              Référence pneumatique
            </span>
            <p className="text-[11px] text-muted-foreground">
              {refConfirmed
                ? `Confirmée : ${stored.confirmedRef}`
                : refState === "reconnue"
                  ? "Référence lue au flanc — vérifiez puis confirmez."
                  : refState === "partielle"
                    ? "Lecture partielle — complétez puis confirmez."
                    : "Aucune lecture — saisissez la référence, exemple : 195/55 R16 87H."}
            </p>
            <div className="flex gap-2">
              <input
                value={currentRef}
                placeholder="195/55 R16 87H"
                onChange={(e) => {
                  setRefTouched(true);
                  setRefInput(e.target.value);
                }}
                className="flex-1 rounded-lg border-2 border-border px-2 py-2 text-sm font-bold uppercase"
              />
              <button
                type="button"
                onClick={() => void confirmRef()}
                className="rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground"
              >
                Confirmer
              </button>
            </div>
            {!refConfirmed ? (
              <p className="text-[11px] font-semibold text-amber-700">
                Le devis pneus reste bloqué tant que la référence n'est pas confirmée (le tour peut
                être clôturé sans dimension).
              </p>
            ) : null}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {publicQuery.isFetching
              ? "Consultation des tarifs publics en cours…"
              : publicQuery.data?.ok
                ? `Tarifs publics CentralePneus consultés le ${new Date(publicQuery.data.consultedAt).toLocaleString("fr-FR")}`
                : effectiveSize
                  ? (publicQuery.data?.error ?? "Tarif actuellement indisponible")
                  : "Référence non confirmée — le chiffrage pneus est en attente."}
          </p>

          {sizeConfidenceMessage({
            size: effectiveSize,
            load: requiredLoad ?? result?.load_index ?? null,
            speed: requiredSpeed ?? result?.speed_index ?? null,
          }) ? (
            <p className="text-[11px] font-semibold text-amber-700">
              {sizeConfidenceMessage({
                size: effectiveSize,
                load: requiredLoad ?? result?.load_index ?? null,
                speed: requiredSpeed ?? result?.speed_index ?? null,
              })}
            </p>
          ) : null}

          {identical ? <OfferCard offer={identical} selected={selectedSlot === identical.slot} onSelect={() => void selectOffer(identical)} /> : null}

          <button
            type="button"
            onClick={() => setShowOthers((v) => !v)}
            className="flex w-full items-center justify-center gap-1 rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase"
          >
            {showOthers ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showOthers ? "Masquer les autres offres" : "Voir les 6 autres offres +"}
          </button>

          {showOthers ? (
            <div className="space-y-2">
              {others.map((o) => (
                <OfferCard key={o.slot} offer={o} selected={selectedSlot === o.slot} onSelect={() => void selectOffer(o)} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <PhotoManager
        key={photoKey}
        compact
        folder={`inspections/${inspectionId}`}
        links={{ inspection_id: inspectionId, inspection_point_id: point.id }}
      />

      {cameraOpen ? (
        <BurstCamera
          steps={freeCamera ? [] : STEPS}
          allowFree={false}
          autoFinish={!freeCamera}
          title={point.point_label}
          onFinish={(shots) => void onShots(shots, freeCamera)}
          onCancel={() => {
            setCameraOpen(false);
            setFreeCamera(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value ?? "Non lisible"}</dd>
    </div>
  );
}

function OfferCard({
  offer,
  selected,
  onSelect,
}: {
  offer: SevenOffer;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className={`rounded-lg border-2 p-3 text-xs ${selected ? "border-brand bg-brand/5" : "border-border"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-extrabold uppercase">{offer.title}</span>
        <span className="font-extrabold">{offer.available ? `${euro(offer.totalTtc)} TTC posé` : "—"}</span>
      </div>
      {offer.available ? (
        <>
          <p className="mt-1 font-semibold">
            {offer.brand} {offer.model} · {offer.size ?? "dimension à confirmer"}
            {offer.loadIndex || offer.speedIndex ? ` ${offer.loadIndex ?? ""}${offer.speedIndex ?? ""}` : ""}
            {offer.season ? ` · ${SEASON_LABEL[offer.season]}` : ""}
            {offer.tier ? ` · ${TIER_LABEL[offer.tier]}` : ""}
          </p>
          <p className="text-muted-foreground">
            {offer.quantity} × {euro(offer.unitSellHt)} HT · montage {euro(offer.mountTtc)}
            {offer.mountLabel ? ` (${offer.mountLabel})` : " — tarif montage indisponible"}
          </p>
          <p className="text-muted-foreground">
            {offer.availability ?? "Disponibilité non communiquée"} · consulté le{" "}
            {offer.consultedAt ? new Date(offer.consultedAt).toLocaleDateString("fr-FR") : "—"} ·{" "}
            {offer.compatibilityMessage}
          </p>
          <button
            type="button"
            onClick={onSelect}
            className={`mt-2 w-full rounded-lg px-3 py-2 text-xs font-extrabold uppercase ${
              selected ? "bg-brand text-brand-foreground" : "border-2 border-border"
            }`}
          >
            {selected ? "Offre retenue" : "Retenir cette offre"}
          </button>
        </>
      ) : (
        <p className="mt-1 text-amber-700">{offer.unavailableReason}</p>
      )}
    </div>
  );
}

function EditForm({
  draft,
  setDraft,
  grade,
  setGrade,
  motif,
  setMotif,
  onCancel,
  onSave,
}: {
  draft: TireWheelAi;
  setDraft: (v: TireWheelAi) => void;
  grade: TireGrade;
  setGrade: (v: TireGrade) => void;
  motif: string;
  setMotif: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = (patch: Partial<TireWheelAi>) => setDraft({ ...draft, ...patch });
  const text = (label: string, key: keyof TireWheelAi) => (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <input
        value={(draft[key] as string | null) ?? ""}
        onChange={(e) => set({ [key]: e.target.value || null } as Partial<TireWheelAi>)}
        className="w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
      />
    </label>
  );
  const flag = (label: string, key: keyof TireWheelAi) => (
    <label className="flex items-center gap-2 text-xs font-semibold">
      <input
        type="checkbox"
        checked={Boolean(draft[key])}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<TireWheelAi>)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );

  return (
    <div className="space-y-3 rounded-lg bg-secondary p-3">
      <div className="grid grid-cols-2 gap-2">
        {text("Marque", "brand")}
        {text("Modèle", "model")}
        {text("Dimension", "size")}
        {text("Indice de charge", "load_index")}
        {text("Indice de vitesse", "speed_index")}
        {text("DOT", "dot")}
        <label className="block">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Saison</span>
          <select
            value={draft.season ?? ""}
            onChange={(e) => set({ season: e.target.value || null })}
            className="w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
          >
            <option value="">Non déterminée</option>
            <option value="ete">Été</option>
            <option value="quatre_saisons">4 saisons</option>
            <option value="hiver">Hiver</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Profondeur (mm)</span>
          <input
            inputMode="decimal"
            value={draft.depth_mm ?? ""}
            onChange={(e) =>
              set({
                depth_mm: e.target.value.trim() === "" ? null : Number(e.target.value.replace(",", ".")),
                depth_kind: "mesure",
              })
            }
            className="w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {flag("Craquelures", "cracks")}
        {flag("Coupure", "cuts")}
        {flag("Hernie", "bulges")}
        {flag("Corps étranger", "foreign_objects")}
        {flag("Flanc endommagé", "sidewall_damage")}
        {flag("Jante endommagée", "rim_damage")}
      </div>

      <label className="block">
        <span className="text-[10px] font-bold uppercase text-muted-foreground">Usure</span>
        <select
          value={draft.wear ?? ""}
          onChange={(e) => set({ wear: (e.target.value || null) as TireWheelAi["wear"] })}
          className="w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
        >
          <option value="">Non déterminée</option>
          <option value="reguliere">Régulière</option>
          <option value="irreguliere">Irrégulière</option>
        </select>
      </label>

      <label className="block">
        <span className="text-[10px] font-bold uppercase text-muted-foreground">Recommandation</span>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value as TireGrade)}
          className="w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
        >
          {(Object.keys(GRADE_LABEL) as TireGrade[]).map((g) => (
            <option key={g} value={g}>
              {GRADE_LABEL[g]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="text-[10px] font-bold uppercase text-muted-foreground">Commentaire client</span>
        <textarea
          rows={2}
          value={draft.client_comment ?? ""}
          onChange={(e) => set({ client_comment: e.target.value || null })}
          className="w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-[10px] font-bold uppercase text-muted-foreground">Motif de la correction</span>
        <select
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          className="w-full rounded-lg border-2 border-border px-2 py-2 text-sm"
        >
          {MOTIFS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="flex-1 rounded-lg bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground"
        >
          Enregistrer la correction
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border-2 border-border px-3 py-3 text-xs font-extrabold uppercase"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
