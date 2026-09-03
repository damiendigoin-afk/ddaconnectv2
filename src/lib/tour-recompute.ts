/**
 * Recalcul d'un Tour Véhicule déjà réalisé.
 *
 * Le bouton « Recalculer le chiffrage » ne doit rien exiger de l'opérateur :
 * les offres pneumatiques sont reconstruites à partir de l'étiquette pneus déjà
 * enregistrée (point `etiquette_pneus`) et le ticket de testeur batterie déjà
 * photographié est relu automatiquement. Rien n'est inventé : sans donnée
 * exploitable, le message précis d'origine est conservé.
 */
import { supabase } from "@/integrations/supabase/client";
import { ocrBatteryTest } from "./ocr.functions";
import type { CommercialSettings, ServicePackage } from "./pricing-engine";
import { blobToDataUrl, mediaUrl } from "./photo";
import { fetchPublicTireOffers } from "./tire-provider.functions";
import type { TireLabelAi, TireWheelAi } from "./tire-types";
import {
  axleKindOf,
  buildSevenOffers,
  fetchBrandTiers,
  publicItemsToOffers,
  requiredFromLabel,
  type PublicTireItem,
  type SevenOffer,
  type TireOffer,
  type TireSeason,
} from "./tires";

type PointRow = {
  id: string;
  point_key: string;
  point_label: string;
  status: string;
  battery_test: unknown;
  tire_analysis: unknown;
  tire_label: unknown;
};

export type RecomputeReport = {
  tireWheels: number;
  tireOffers: number;
  batteryRead: boolean;
  notes: string[];
};

function isDefect(status: string) {
  return status === "defect" || status === "watch";
}

/** Choix automatique de l'offre retenue : identique si disponible, sinon la moins chère. */
export function pickBestOffer(offers: SevenOffer[]): SevenOffer | null {
  const available = offers.filter((o) => o.available && o.totalTtc != null);
  if (!available.length) return null;
  const identical = available.find((o) => o.kind === "identique");
  if (identical) return identical;
  return [...available].sort((a, b) => (a.totalTtc ?? 0) - (b.totalTtc ?? 0))[0] ?? null;
}

export function offerRows(
  offers: SevenOffer[],
  args: { inspectionId: string; pointId: string; wheelCode: string; selectedSlot: string | null },
) {
  return offers.map((o) => ({
    inspection_id: args.inspectionId,
    inspection_point_id: args.pointId,
    wheel_code: args.wheelCode,
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
    consulted_at: o.consultedAt ?? new Date().toISOString(),
    margin_ht: o.marginHt,
    sell_price_ht: o.unitSellHt,
    mount_package: o.mountLabel,
    mount_total_ttc: o.mountTtc,
    total_ht: o.totalHt,
    total_vat: o.totalVat,
    total_ttc: o.totalTtc,
    availability: o.availability,
    compatibility: o.compatibilityMessage,
    selected: args.selectedSlot != null && o.slot === args.selectedSlot,
    initial_payload: o as never,
    final_payload: args.selectedSlot != null && o.slot === args.selectedSlot ? (o as never) : null,
  }));
}

/**
 * Enregistrement tolérant des offres : un lot refusé est réessayé ligne par
 * ligne pour ne jamais perdre les propositions exploitables. Une offre
 * incomplète (prix ou dimension manquants) reste enregistrable.
 */
async function insertOffersResilient(
  rows: ReturnType<typeof offerRows>,
): Promise<{ count: number; error: string | null }> {
  if (!rows.length) return { count: 0, error: null };
  const { error } = await supabase.from("tire_quote_offers").insert(rows);
  if (!error) return { count: rows.length, error: null };

  let count = 0;
  let last: string | null = error.message;
  for (const row of rows) {
    const res = await supabase.from("tire_quote_offers").insert(row);
    if (res.error) last = res.error.message;
    else count += 1;
  }
  return { count, error: count === rows.length ? null : last };
}

/**
 * Reconstruction des offres et relecture du ticket batterie avant chiffrage.
 * Idempotent : les offres déjà retenues par un opérateur ne sont pas écrasées.
 */
export async function prepareTourPricing(inspectionId: string): Promise<RecomputeReport> {
  const report: RecomputeReport = { tireWheels: 0, tireOffers: 0, batteryRead: false, notes: [] };

  const { data: rawPoints } = await supabase
    .from("inspection_points")
    .select("id, point_key, point_label, status, battery_test, tire_analysis, tire_label")
    .eq("inspection_id", inspectionId);
  const points = (rawPoints ?? []) as unknown as PointRow[];
  if (!points.length) return report;

  await rebuildTireOffers(inspectionId, points, report);
  await rereadBatteryTicket(inspectionId, points, report);
  return report;
}

/* ------------------------------ Pneumatiques ------------------------------ */

async function rebuildTireOffers(inspectionId: string, points: PointRow[], report: RecomputeReport) {
  const wheels = points.filter((p) => /^pneu_/.test(p.point_key) && isDefect(p.status));
  if (!wheels.length) return;

  const labelPoint = points.find((p) => p.point_key === "etiquette_pneus");
  const stored = (labelPoint?.tire_label ?? null) as { label?: TireLabelAi | null } | null;
  const label = stored?.label ?? null;

  const { data: existing } = await supabase
    .from("tire_quote_offers")
    .select("id, inspection_point_id, selected, total_ttc")
    .eq("inspection_id", inspectionId);

  const bySelected = new Set(
    (existing ?? []).filter((o) => o.selected && o.total_ttc != null).map((o) => o.inspection_point_id ?? ""),
  );

  // Une seule offre retenue par essieu : le devis ne double jamais les pneus.
  const axleTaken = new Set<string>();
  for (const w of wheels) {
    if (bySelected.has(w.id)) axleTaken.add(axleKindOf(w.point_key.replace("pneu_", "")));
  }

  const [settingsRes, catalogRes, packagesRes, brands] = await Promise.all([
    supabase.from("commercial_settings").select("*").limit(1).maybeSingle(),
    supabase.from("tire_offers").select("*").eq("active", true),
    supabase.from("service_packages").select("*").eq("active", true),
    fetchBrandTiers(),
  ]);
  const settings = (settingsRes.data ?? null) as CommercialSettings | null;
  const catalog = (catalogRes.data ?? []) as TireOffer[];
  const packages = (packagesRes.data ?? []) as ServicePackage[];

  const publicCache = new Map<string, PublicTireItem[]>();

  for (const wheel of wheels) {
    if (bySelected.has(wheel.id)) continue;
    const code = wheel.point_key.replace("pneu_", "");
    const axle = axleKindOf(code);

    const analysis = ((wheel.tire_analysis ?? null) as { final?: TireWheelAi | null; ai?: TireWheelAi | null } | null);
    const mountedAi = analysis?.final ?? analysis?.ai ?? null;

    const fromLabel = requiredFromLabel(label, code);
    const required = {
      size: fromLabel.size ?? mountedAi?.size ?? null,
      load: fromLabel.load ?? mountedAi?.load_index ?? null,
      speed: fromLabel.speed ?? mountedAi?.speed_index ?? null,
    };
    if (!required.size) {
      report.notes.push(
        `${wheel.point_label} : dimension inconnue (étiquette pneumatiques non exploitable).`,
      );
      continue;
    }

    let items = publicCache.get(required.size);
    if (!items) {
      const res = await fetchPublicTireOffers({ data: { size: required.size } });
      if (!res.ok) {
        report.notes.push(`Tarifs publics indisponibles pour ${required.size} : ${res.error}`);
        items = [];
      } else {
        items = res.items as PublicTireItem[];
      }
      publicCache.set(required.size, items);
    }

    const quantity = wheels.filter((w) => axleKindOf(w.point_key.replace("pneu_", "")) === axle).length || 1;

    const offers = buildSevenOffers({
      offers: [...publicItemsToOffers(items, brands), ...catalog],
      brands,
      packages,
      settings,
      quantity,
      mounted: {
        brand: mountedAi?.brand ?? null,
        model: mountedAi?.model ?? null,
        size: mountedAi?.size ?? required.size,
        season: (mountedAi?.season as TireSeason | null) ?? null,
      },
      required,
    });

    const best = axleTaken.has(axle) ? null : pickBestOffer(offers);
    if (best) axleTaken.add(axle);

    const purge = await supabase.from("tire_quote_offers").delete().eq("inspection_point_id", wheel.id);
    if (purge.error) {
      report.notes.push(
        `${wheel.point_label} : anciennes offres non supprimées (${purge.error.message}) — les nouvelles s'ajoutent.`,
      );
    }
    const rows = offerRows(offers, {
      inspectionId,
      pointId: wheel.id,
      wheelCode: code,
      selectedSlot: best?.slot ?? null,
    });
    const saved = await insertOffersResilient(rows);
    if (!saved.count) {
      report.notes.push(
        `${wheel.point_label} : enregistrement des offres refusé par la base (${saved.error ?? "raison inconnue"}).`,
      );
      continue;
    }
    if (saved.error) {
      report.notes.push(
        `${wheel.point_label} : ${saved.count}/${rows.length} offres enregistrées, les autres sont à compléter (${saved.error}).`,
      );
    }
    report.tireWheels += 1;
    report.tireOffers += rows.slice(0, saved.count).filter((r) => r.total_ttc != null).length;
    if (!best) {
      report.notes.push(
        `${wheel.point_label} : aucune offre exploitable en ${required.size} — proposition à confirmer.`,
      );
    }
  }
}

/* -------------------------------- Batterie -------------------------------- */

async function rereadBatteryTicket(inspectionId: string, points: PointRow[], report: RecomputeReport) {
  const battery = points.find((p) => /^batterie/.test(p.point_key) && isDefect(p.status));
  if (!battery) return;
  const test = (battery.battery_test ?? null) as { verdict?: string | null } | null;
  if (test?.verdict) return;

  const { data: media } = await supabase
    .from("media")
    .select("id, storage_path, label, inspection_point_id")
    .eq("inspection_id", inspectionId)
    .order("created_at", { ascending: false });

  const candidates = (media ?? []).filter(
    (m) =>
      m.inspection_point_id === battery.id ||
      /batterie|ticket|testeur/i.test(`${m.label ?? ""} ${m.storage_path}`),
  );
  if (!candidates.length) {
    report.notes.push("Batterie : aucune photo de ticket testeur disponible — test batterie manquant.");
    return;
  }

  // Une seule photo prioritaire : jamais de boucle payante sur plusieurs médias.
  for (const candidate of candidates.slice(0, 1)) {
    try {
      const url = await mediaUrl(candidate.storage_path);
      if (!url) continue;
      const blob = await (await fetch(url)).blob();
      const dataUrl = await blobToDataUrl(blob);
      const res = await ocrBatteryTest({ data: { dataUrl, filename: "batterie.jpg" } });
      if (!res.ok) continue;
      const parsed = JSON.parse(res.json) as { verdict?: string | null; cca_measured?: number | null };
      if (!parsed.verdict) continue;
      await supabase
        .from("inspection_points")
        .update({
          battery_test: JSON.parse(JSON.stringify(parsed)),
          measure_value: parsed.cca_measured != null ? `${parsed.cca_measured} CCA` : null,
          battery_media_id: candidate.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", battery.id);
      report.batteryRead = true;
      return;
    } catch {
      // Photo illisible : on tente la suivante, sans jamais déduire un verdict.
    }
  }
  report.notes.push("Batterie : ticket testeur existant illisible — test batterie à refaire.");
}
