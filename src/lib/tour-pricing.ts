/**
 * Pont Tour Véhicule → moteur central de chiffrage.
 * Les constats du tour (statut de chaque point) sont qualifiés puis chiffrés par
 * le moteur unique : la même anomalie produit le même prix qu'en Expertise.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePlate } from "./plate";
import {
  loadEngineContext,
  priceMechanical,
  contactItem,
  findBatteryPackages,
  packageItem,
  priceBodyworkLevel,
  priceCleaning,
  type EngineContext,
  type PricedItem,
  type Priority,
} from "./pricing-engine";
import { buildVehicleProfile, type VehicleProfile } from "./vehicle-profile";
import {
  mountPackageFor,
  parseTireReference,
  type TireQuoteOffer,
} from "./tires";
import {
  groupTireAxles,
  normalizeSevenChoices,
  selectedTireChoice,
  tireGroupTitle,
  type TireQuoteChoice,
  type TireQuoteComputation,
} from "./tour-tire-groups";
import { laborRate } from "./pricing";

type PointRow = {
  id: string;
  point_key: string;
  point_label: string;
  status: string;
  comment: string | null;
  measure_value: string | null;
  battery_test: unknown;
  tire_analysis: unknown;
};

type BatteryTest = {
  verdict?: string | null;
  voltage?: number | null;
  cca_measured?: number | null;
  cca_rated?: number | null;
  capacity_ah?: number | null;
  soh_pct?: number | null;
  soc_pct?: number | null;
};


const BATTERY_OPERATIONS = ["batterie_remplacement", "batterie", "remplacement_batterie"];

function batteryDetail(t: BatteryTest): string {
  const parts: string[] = [];
  if (t.voltage != null) parts.push(`${t.voltage} V`);
  if (t.cca_measured != null) parts.push(`${t.cca_measured} CCA mesurés`);
  if (t.cca_rated != null) parts.push(`${t.cca_rated} CCA nominaux`);
  if (t.soh_pct != null) parts.push(`SOH ${t.soh_pct} %`);
  if (t.soc_pct != null) parts.push(`SOC ${t.soc_pct} %`);
  return parts.length ? `Ticket testeur : ${parts.join(" · ")}` : "Ticket testeur lu.";
}

/** Priorité déduite du statut de qualification du point. */
export function priorityFromStatus(status: string): Priority | null {
  if (status === "defect") return "urgent";
  if (status === "watch") return "a_surveiller";
  return null;
}

type Mapping =
  | { kind: "mecanique"; operation: string; label: string }
  | { kind: "carrosserie"; element: string }
  | { kind: "pneu" }
  | { kind: "nettoyage" }
  | { kind: "batterie" };


/** Correspondance point de contrôle → opération chiffrable. */
export function mapPoint(pointKey: string): Mapping | null {
  if (/^pneu_/.test(pointKey)) return { kind: "pneu" };
  if (/^proprete/.test(pointKey)) return { kind: "nettoyage" };
  if (/^batterie/.test(pointKey)) return { kind: "batterie" };
  if (/^frein_/.test(pointKey))
    return { kind: "mecanique", operation: "plaquettes", label: "Freinage — plaquettes" };
  if (/^(essuie|balai)/.test(pointKey))
    return { kind: "mecanique", operation: "balais_essuie_glace", label: "Balais d'essuie-glace" };
  if (/^filtre_habitacle/.test(pointKey))
    return { kind: "mecanique", operation: "filtre_habitacle", label: "Filtre habitacle" };
  if (/^climatisation/.test(pointKey))
    return { kind: "mecanique", operation: "clim_r134a", label: "Entretien climatisation" };
  if (/^voyants/.test(pointKey))
    return { kind: "mecanique", operation: "lecture_codes", label: "Lecture des codes défaut" };
  if (/^retroviseur/.test(pointKey)) return { kind: "carrosserie", element: "retroviseur" };
  if (/^porte_av/.test(pointKey)) return { kind: "carrosserie", element: "porte_avant" };
  if (/^porte_ar/.test(pointKey)) return { kind: "carrosserie", element: "porte_arriere" };
  if (/^aile_av/.test(pointKey)) return { kind: "carrosserie", element: "aile_avant" };
  if (/^aile_ar/.test(pointKey)) return { kind: "carrosserie", element: "aile_arriere" };
  if (/^capot/.test(pointKey)) return { kind: "carrosserie", element: "capot" };
  if (/^hayon/.test(pointKey)) return { kind: "carrosserie", element: "hayon" };
  if (/pare_choc_avant|bouclier_avant/.test(pointKey))
    return { kind: "carrosserie", element: "bouclier_avant" };
  if (/pare_choc_arriere|bouclier_arriere/.test(pointKey))
    return { kind: "carrosserie", element: "bouclier_arriere" };
  return null;
}

export async function vehicleProfileForPlate(
  plate: string | null | undefined,
  fallback: { brand?: string | null; model?: string | null } = {},
): Promise<VehicleProfile> {
  const normalized = plate ? normalizePlate(plate) : "";
  if (normalized) {
    const { data } = await supabase
      .from("ref_vehicles")
      .select(
        "id, brand, model, version, energy, segment, first_registration_date, last_mileage, homologated_tire_size",
      )
      .eq("registration_normalized", normalized)
      .limit(1)
      .maybeSingle();
    if (data) {
      return buildVehicleProfile({
        refVehicleId: data.id,
        plate: plate ?? null,
        brand: data.brand,
        model: data.model,
        version: data.version,
        energy: data.energy,
        segment: data.segment,
        firstRegistrationDate: data.first_registration_date,
        mileage: data.last_mileage,
        homologatedTireSize: data.homologated_tire_size,
      });
    }
  }
  return buildVehicleProfile({
    plate: plate ?? null,
    brand: fallback.brand ?? null,
    model: fallback.model ?? null,
  });
}

/** Chiffre tous les constats non conformes d'un tour véhicule. */
export async function priceTour(args: {
  inspectionId: string;
  plate?: string | null;
  brand?: string | null;
  model?: string | null;
}): Promise<{ ctx: EngineContext; vehicle: VehicleProfile; items: PricedItem[] }> {
  const [{ data: points }, { data: tireOffers }, ctx, vehicle] = await Promise.all([
    supabase
      .from("inspection_points")
      .select(
        "id, point_key, point_label, status, comment, measure_value, battery_test, tire_analysis",
      )
      .eq("inspection_id", args.inspectionId)
      .order("zone_index"),
    supabase
      .from("tire_quote_offers")
      .select("*")
      .eq("inspection_id", args.inspectionId),
    loadEngineContext(),
    vehicleProfileForPlate(args.plate, { brand: args.brand ?? null, model: args.model ?? null }),
  ]);

  const offersByPoint = new Map<string, TireQuoteOffer[]>();
  for (const o of (tireOffers ?? []) as TireQuoteOffer[]) {
    const key = o.inspection_point_id ?? "";
    offersByPoint.set(key, [...(offersByPoint.get(key) ?? []), o]);
  }

  const items: PricedItem[] = [];
  /** Tous les pneus concernés sont regroupés avant tout ajout au devis. */
  const pendingTires: { point: PointRow; priority: Priority; offersReady: number; axle?: string }[] = [];

  for (const p of (points ?? []) as PointRow[]) {

    const priority = priorityFromStatus(p.status);
    const mapping = mapPoint(p.point_key);
    const detail = p.comment ?? "";

    /* ---------------------------- Batterie ---------------------------- */
    if (mapping?.kind === "batterie") {
      const test = (p.battery_test ?? null) as BatteryTest | null;
      if (!test?.verdict) {
        if (!priority) continue;
        items.push(
          contactItem({
            label: p.point_label,
            block: "mecanique",
            priority,
            detail,
            reason:
              "Donnée manquante : interprétation du test batterie (photo du ticket testeur ou verdict à saisir).",
            originPointKey: p.point_key,
          }),
        );
        continue;
      }
      if (test.verdict !== "a_remplacer") continue;

      items.push(
        priceBatteryReplacement({
          ctx,
          vehicle,
          label: `${p.point_label} — remplacement batterie`,
          priority: priority ?? "a_remplacer",
          detail: [detail, batteryDetail(test)].filter(Boolean).join(" · "),
          test,
          originPointKey: p.point_key,
        }),
      );

      continue;
    }

    if (!priority) continue;

    /* --------------------------- Pneumatiques -------------------------- */
    if (mapping?.kind === "pneu") {
      const axle = /_ar/.test(p.point_key) ? "arriere" : "avant";
      const pointOffers = offersByPoint.get(p.id) ?? [];
      pendingTires.push({
        point: p,
        priority,
        offersReady: pointOffers.filter((o) => o.total_ttc != null).length,
        axle,
      });

      continue;
    }


    /* ---------------------------- Nettoyage ---------------------------- */
    if (mapping?.kind === "nettoyage") {
      items.push(
        priceCleaning({
          label: p.point_label,
          priority,
          detail: [p.point_label, detail].filter(Boolean).join(" — "),
          originPointKey: p.point_key,
        }),
      );
      continue;
    }

    if (!mapping) {
      items.push(
        contactItem({
          label: p.point_label,
          block: "mecanique",
          priority,
          detail,
          reason: "Constat à qualifier par l'atelier avant chiffrage.",
          originPointKey: p.point_key,
        }),
      );
      continue;
    }
    if (mapping.kind === "mecanique") {
      const it = priceMechanical(ctx, {
        operationCode: mapping.operation,
        label: `${p.point_label} — ${mapping.label}`,
        vehicle,
        priority,
        detail,
      });
      items.push({
        ...it,
        originPointKey: p.point_key,
        computation: { ...it.computation, method: it.ok ? "forfait_ou_grille_atelier" : "contact_operateur" },
      });
    } else if (mapping.kind === "carrosserie") {
      // Aucun passage automatique au remplacement : le niveau d'intervention est
      // pré-lu puis validé par l'opérateur, et le temps n'est jamais figé.
      items.push(
        priceBodyworkLevel(ctx, {
          elementKey: mapping.element,
          priority,
          detail: [p.point_label, detail].filter(Boolean).join(" — "),
          originPointKey: p.point_key,
        }),
      );
    }
  }

  if (pendingTires.length) {
    const memory = await tireMemoryFor(args.inspectionId);
    items.push(...buildTireGroupItems(pendingTires, offersByPoint, memory, vehicle.homologatedTireSize ?? null));
  }

  return { ctx, vehicle, items };
}

/* --------------------------- Batterie : chiffrage -------------------------- */

/**
 * Priorité au référentiel de forfaits (mémentos Renault/Dacia importés) :
 * 1) code opération normalisé, 2) recherche libellé « batterie » sur la marque /
 * gamme du véhicule, 3) seulement ensuite la proposition générique.
 */
export function priceBatteryReplacement(args: {
  ctx: EngineContext;
  vehicle: VehicleProfile;
  label: string;
  priority: Priority;
  detail: string;
  test?: BatteryTest | null;
  originPointKey?: string | null;
}): PricedItem {
  const { ctx, vehicle } = args;

  for (const code of BATTERY_OPERATIONS) {
    const candidate = priceMechanical(ctx, {
      operationCode: code,
      label: args.label,
      vehicle,
      priority: args.priority,
      detail: args.detail,
    });
    if (candidate.ok && !candidate.needsContact) {
      return {
        ...candidate,
        originPointKey: args.originPointKey ?? null,
        computation: {
          ...candidate.computation,
          method: "forfait_batterie_referentiel",
          battery_test: (args.test ?? null) as unknown,
        },
      };
    }
  }

  const search = findBatteryPackages(ctx, vehicle, {
    capacityAh: args.test?.capacity_ah ?? null,
    ratedAmp: args.test?.cca_rated ?? null,
  });
  if (search.best) {
    const choices = search.candidates.slice(0, 8).map((p) => ({
      id: p.id,
      label: p.label,
      operation_code: p.operation_code,
      model: p.model,
      price_ttc: p.price_ttc,
      hours: p.hours,
    }));
    return packageItem(ctx, search.best, {
      label: args.label,
      ...(search.ambiguous
        ? {
            forceLabel: `Forfait batterie Renault à sélectionner — ${search.best.pkg.label}`,
          }
        : {}),
      priority: args.priority,
      detail: args.detail,
      originPointKey: args.originPointKey ?? null,
      message: search.ambiguous
        ? "Forfait batterie Renault à sélectionner : plusieurs forfaits correspondent."
        : "",
      extraComputation: {
        method: "forfait_batterie_referentiel",
        battery_test: (args.test ?? null) as unknown,
        battery_package_choices: choices,
        battery_package_ambiguous: search.ambiguous,
      },
    });
  }

  return genericBatteryItem({
    ctx,
    label: args.label,
    priority: args.priority,
    detail: args.detail,
    test: args.test ?? null,
    originPointKey: args.originPointKey ?? null,
  });
}

/* ------------------------- Propositions génériques ------------------------ */

const GENERIC_BATTERY_HOURS = 0.4;


/**
 * Aucun forfait batterie au référentiel : on propose quand même une ligne
 * exploitable (main-d'œuvre chiffrée à la grille + pièce à compléter) plutôt
 * qu'un devis vide. Le prix de la batterie reste à saisir par l'opérateur.
 */
export function genericBatteryItem(args: {
  ctx: EngineContext;
  label: string;
  priority: Priority;
  detail: string;
  test?: BatteryTest | null;
  originPointKey?: string | null;
}): PricedItem {
  const rate = laborRate(args.ctx.pricing?.rates ?? []);
  const ht = Math.round(GENERIC_BATTERY_HOURS * rate.ht * 100) / 100;
  const ttc = Math.round(GENERIC_BATTERY_HOURS * rate.ttc * 100) / 100;
  const capacity = args.test?.cca_rated ? `${args.test.cca_rated} CCA nominaux` : "type/capacité à confirmer";
  return {
    ok: ht > 0,
    needsContact: true,
    message: "Batterie à compléter : référence et prix pièce à renseigner.",
    label: `${args.label} (référence à confirmer)`,
    detail: [args.detail, `Pièce non chiffrée — ${capacity}. Main-d'œuvre pose incluse.`]
      .filter(Boolean)
      .join(" · "),
    block: "mecanique",
    priority: args.priority,
    quantity: 1,
    hours: GENERIC_BATTERY_HOURS,
    unitHt: ht,
    totalHt: ht,
    totalTtc: ttc,
    source: ht > 0 ? "grille_atelier" : "saisie_manuelle",
    confidence: "faible",
    computation: {
      method: "proposition_generique_batterie",
      labor_hours: GENERIC_BATTERY_HOURS,
      labor_rate_ht: rate.ht,
      battery_part_ht: null,
      battery_test: (args.test ?? null) as unknown,
    },
    originPointKey: args.originPointKey ?? null,
  };
}

/** Dimension exploitable d'un point pneu : référence confirmée, puis lecture IA. */
export function tireSizeOfPoint(analysis: unknown): string | null {
  const a = (analysis ?? null) as
    | { confirmedRef?: string | null; final?: { size?: string | null } | null; ai?: { size?: string | null } | null }
    | null;
  if (!a) return null;
  for (const candidate of [a.confirmedRef, a.final?.size, a.ai?.size]) {
    const parsed = parseTireReference(candidate);
    if (parsed.display) return parsed.display;
  }
  return null;
}

async function tireMemoryFor(inspectionId: string): Promise<{ front: string | null; rear: string | null }> {
  const { data } = await supabase
    .from("vehicle_inspections")
    .select("vehicle:vehicles(tire_size_front, tire_size_rear)")
    .eq("id", inspectionId)
    .maybeSingle();
  const v = (data as { vehicle?: { tire_size_front?: string | null; tire_size_rear?: string | null } | null } | null)
    ?.vehicle;
  return { front: v?.tire_size_front ?? null, rear: v?.tire_size_rear ?? null };
}

/**
 * Regroupement des pneus constatés (défaut ET à surveiller) en propositions
 * « x pneus », avec forfait de montage si référencé. Sans dimension exploitable,
 * la ligne reste présente avec la mention « dimension à renseigner ».
 */
export function groupTireItems(
  ctx: EngineContext,
  pending: { point: PointRow; priority: Priority; offersReady: number }[],
  memory: { front: string | null; rear: string | null } = { front: null, rear: null },
  homologated: string | null = null,
): PricedItem[] {
  const groups = tireGroups(pending, memory, homologated);

  const out: PricedItem[] = [];
  for (const g of groups) {
    const quantity = g.quantity;
    const mount = mountPackageFor(ctx.packages, quantity);
    const wheels = g.values.map((e) => e.point.point_label).join(", ");
    const priority: Priority = g.values.some((e) => e.priority === "urgent") ? "urgent" : "a_surveiller";
    const offersReady = g.values.reduce((s, e) => s + e.offersReady, 0);
    const ttc = mount?.totalTtc ?? 0;
    const ht = Math.round((ttc / 1.2) * 100) / 100;
    const axleLabel = g.axles.length === 2 ? "avant et arrière" : g.axles[0] === "arriere" ? "arrière" : "avant";
    out.push({
      ok: false,
      needsContact: true,
      message: g.size
        ? "Prix pneu à compléter : offre fournisseur non disponible."
        : "Chiffrage incomplet : renseigner la dimension pneu.",
      label: tireGroupTitle({ key: g.key, size: g.size, quantity }),
      detail: [
        `Essieu ${axleLabel} : remplacement par paire (constats : ${wheels})`,
        offersReady ? `${offersReady} proposition(s) fournisseur préparée(s) à retenir` : null,
        mount ? `Montage inclus : ${mount.label}` : "Forfait de montage non référencé",
        "Prix pneu à saisir ou à retenir depuis les offres.",
      ]
        .filter(Boolean)
        .join(" · "),
      block: "mecanique",
      priority,
      quantity,
      hours: null,
      unitHt: mount ? Math.round((mount.unitTtc / 1.2) * 100) / 100 : null,
      totalHt: ht,
      totalTtc: ttc,
      source: mount ? "grille_atelier" : "saisie_manuelle",
      confidence: "faible",
      computation: {
        method: "proposition_generique_pneus",
        size: g.size,
        axles: g.axles,
        wheels: g.values.map((e) => e.point.point_key),
        mount_package: mount?.label ?? null,
        mount_total_ttc: mount?.totalTtc ?? null,
        tire_price_ht: null,
      },
      originPointKey: g.values[0]?.point.point_key ?? null,
    });
  }
  return out;
}

function tireGroups(
  pending: { point: PointRow; priority: Priority; offersReady: number }[],
  memory: { front: string | null; rear: string | null },
  homologated: string | null,
) {
  return groupTireAxles(
    pending.map((entry) => {
      const axle = /_ar/.test(entry.point.point_key) ? "arriere" as const : "avant" as const;
      const size =
        tireSizeOfPoint(entry.point.tire_analysis) ||
        parseTireReference(axle === "arriere" ? memory.rear : memory.front).display ||
        parseTireReference(homologated).display ||
        null;
      return { axle, size, value: entry };
    }),
  );
}

function choiceFromRow(row: TireQuoteOffer): TireQuoteChoice | null {
  const payload = row.initial_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.slot !== "string") return null;
  return {
    slot: p.slot,
    kind: p.kind === "identique" ? "identique" : "gamme",
    title: typeof p.title === "string" ? p.title : p.slot,
    tier: (p.tier as TireQuoteChoice["tier"]) ?? null,
    season: (p.season as TireQuoteChoice["season"]) ?? null,
    available: p.available === true,
    unavailableReason: typeof p.unavailableReason === "string" ? p.unavailableReason : "Offre indisponible",
    brand: typeof p.brand === "string" ? p.brand : null,
    model: typeof p.model === "string" ? p.model : null,
    size: typeof p.size === "string" ? p.size : row.size,
    loadIndex: typeof p.loadIndex === "string" ? p.loadIndex : row.load_index,
    speedIndex: typeof p.speedIndex === "string" ? p.speedIndex : row.speed_index,
    quantity: Number(p.quantity ?? row.quantity),
    totalHt: p.totalHt == null ? row.total_ht : Number(p.totalHt),
    totalTtc: p.totalTtc == null ? row.total_ttc : Number(p.totalTtc),
    availability: typeof p.availability === "string" ? p.availability : row.availability,
    compatibility: p.compatibility === "compatible" ? "compatible" : "a_confirmer",
    compatibilityMessage: typeof p.compatibilityMessage === "string" ? p.compatibilityMessage : row.compatibility ?? "Compatibilité à confirmer",
    offerRowId: row.id,
  };
}

function resizeChoice(choice: TireQuoteChoice, quantity: 2 | 4): TireQuoteChoice {
  const original = Number(choice.quantity) || 2;
  if (original === quantity) return choice;
  const ratio = quantity / original;
  return {
    ...choice,
    quantity,
    totalHt: choice.totalHt == null ? null : Math.round(choice.totalHt * ratio * 100) / 100,
    totalTtc: choice.totalTtc == null ? null : Math.round(choice.totalTtc * ratio * 100) / 100,
  };
}

export function buildTireGroupItems(
  pending: { point: PointRow; priority: Priority; offersReady: number }[],
  offersByPoint: Map<string, TireQuoteOffer[]>,
  memory: { front: string | null; rear: string | null } = { front: null, rear: null },
  homologated: string | null = null,
): PricedItem[] {
  return tireGroups(pending, memory, homologated).map((group) => {
    const rows = group.values.flatMap((entry) => offersByPoint.get(entry.point.id) ?? []);
    const choices = normalizeSevenChoices(
      rows.map(choiceFromRow).filter((choice): choice is TireQuoteChoice => Boolean(choice)).map((choice) => resizeChoice(choice, group.quantity)),
      group.quantity,
      group.size,
    );
    const selectedRow = rows.find((row) => row.selected && row.total_ttc != null);
    const selectedSlot = selectedRow ? choiceFromRow(selectedRow)?.slot ?? null : null;
    const computation: TireQuoteComputation = {
      method: "tour_tire_group",
      tire_group: true,
      group_key: group.key,
      axles: group.axles,
      point_ids: group.values.map((entry) => entry.point.id),
      size: group.size,
      quantity: group.quantity,
      selected_slot: selectedSlot,
      offers: choices,
    };
    const selected = selectedTireChoice(computation);
    const priority: Priority = group.values.some((entry) => entry.priority === "urgent") ? "urgent" : "a_surveiller";
    return {
      ok: Boolean(selected),
      needsContact: !selected,
      message: group.size ? "Choisir une proposition pneu." : "Dimension à confirmer.",
      label: tireGroupTitle(group),
      detail: selected ? `${selected.brand ?? ""} ${selected.model ?? ""}`.trim() : "Les sept propositions restent visibles.",
      block: "mecanique",
      priority,
      quantity: group.quantity,
      hours: null,
      unitHt: selected?.totalHt == null ? null : Math.round((selected.totalHt / group.quantity) * 100) / 100,
      totalHt: selected?.totalHt ?? 0,
      totalTtc: selected?.totalTtc ?? 0,
      source: selected ? "prix_fournisseur_pneu" : "saisie_manuelle",
      confidence: selected?.compatibility === "compatible" ? "elevee" : "faible",
      computation,
      originPointKey: group.values[0]?.point.point_key ?? null,
    };
  });
}


export type UnpricedObservation = {
  pointKey: string;
  label: string;
  statusLabel: string;
  reason: string;
};

const STATUS_LABEL: Record<string, string> = {
  ok: "Conforme",
  watch: "À surveiller",
  defect: "Défaut",
  unset: "Non contrôlé",
};

/**
 * Explique, quand aucun chiffrage n'a pu être produit, ce qui a été observé
 * pendant le tour et pourquoi ce n'est pas chiffré.
 */
export async function describeUnpricedTour(inspectionId: string): Promise<UnpricedObservation[]> {
  const { data } = await supabase
    .from("inspection_points")
    .select("point_key, point_label, status, comment")
    .eq("inspection_id", inspectionId)
    .in("status", ["watch", "defect", "unset"]);
  return ((data ?? []) as PointRow[]).map((p) => ({
    pointKey: p.point_key,
    label: p.point_label,
    statusLabel: STATUS_LABEL[p.status ?? "unset"] ?? "Non contrôlé",
    reason:
      p.status === "unset"
        ? "Point non contrôlé : aucun constat à chiffrer."
        : mapPoint(p.point_key)
          ? "Constat chiffrable mais donnée manquante (dimension pneu / type batterie / tarif)."
          : "Aucune correspondance de chiffrage pour ce point : à traiter manuellement.",
  }));
}
