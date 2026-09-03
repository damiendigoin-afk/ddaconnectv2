/**
 * Pont Tour Véhicule → moteur central de chiffrage.
 * Les constats du tour (statut de chaque point) sont qualifiés puis chiffrés par
 * le moteur unique : la même anomalie produit le même prix qu'en Expertise.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizePlate } from "./plate";
import {
  loadEngineContext,
  priceBodywork,
  priceMechanical,
  contactItem,
  type EngineContext,
  type PricedItem,
  type Priority,
} from "./pricing-engine";
import { buildVehicleProfile, type VehicleProfile } from "./vehicle-profile";
import { SEASON_LABEL, type TireQuoteOffer, type TireSeason } from "./tires";

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
  | { kind: "batterie" };

/** Correspondance point de contrôle → opération chiffrable. */
export function mapPoint(pointKey: string): Mapping | null {
  if (/^pneu_/.test(pointKey)) return { kind: "pneu" };
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
  /** Pneus non chiffrés faute d'offre fournisseur : regroupés en fin de parcours. */
  const pendingTires: { point: PointRow; priority: Priority; offersReady: number }[] = [];
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

      let priced: PricedItem | null = null;
      for (const code of BATTERY_OPERATIONS) {
        const candidate = priceMechanical(ctx, {
          operationCode: code,
          label: `${p.point_label} — remplacement batterie`,
          vehicle,
          priority: priority ?? "a_remplacer",
          detail: [detail, batteryDetail(test)].filter(Boolean).join(" · "),
        });
        if (candidate.ok) {
          priced = candidate;
          break;
        }
      }
      items.push(
        priced
          ? {
              ...priced,
              originPointKey: p.point_key,
              computation: {
                ...priced.computation,
                method: "forfait_batterie_referentiel",
                battery_test: test as unknown,
              },
            }
          : contactItem({
              label: `${p.point_label} — remplacement batterie`,
              block: "mecanique",
              priority: priority ?? "a_remplacer",
              detail: batteryDetail(test),
              reason:
                "Donnée manquante : forfait batterie du référentiel (capacité/CCA du véhicule) non paramétré.",
              originPointKey: p.point_key,
            }),
      );
      continue;
    }

    if (!priority) continue;

    /* --------------------------- Pneumatiques -------------------------- */
    if (mapping?.kind === "pneu") {
      const pointOffers = offersByPoint.get(p.id) ?? [];
      const selected = pointOffers.find((o) => o.selected && o.total_ttc != null);
      if (selected) {
        const ttc = Number(selected.total_ttc);
        const ht = Number(selected.total_ht ?? Math.round((ttc / 1.2) * 100) / 100);
        items.push({
          ok: true,
          needsContact: false,
          message: "",
          label: `${selected.quantity} pneu${selected.quantity > 1 ? "x" : ""} ${selected.brand ?? ""} ${
            selected.model ?? ""
          }${selected.size ? ` ${selected.size}` : ""}`.replace(/\s+/g, " ").trim(),
          detail: [
            selected.season ? SEASON_LABEL[selected.season as TireSeason] : null,
            selected.mount_package,
            selected.compatibility,
            selected.availability,
          ]
            .filter(Boolean)
            .join(" · "),
          block: "mecanique",
          priority,
          quantity: Number(selected.quantity ?? 2),
          hours: null,
          unitHt: selected.sell_price_ht == null ? null : Number(selected.sell_price_ht),
          totalHt: Math.round(ht * 100) / 100,
          totalTtc: Math.round(ttc * 100) / 100,
          source: "prix_fournisseur_pneu",
          confidence: selected.compatibility === "Compatible" ? "elevee" : "moyenne",
          originPointKey: p.point_key,
          computation: {
            method: "prix_public_ttc_moins_tva_puis_marge_puis_forfait_montage",
            source_supplier: selected.supplier,
            source_ref: selected.supplier_ref,
            source_price_ht: selected.source_price_ht,
            margin_ht: selected.margin_ht,
            sell_price_ht: selected.sell_price_ht,
            mount_package: selected.mount_package,
            mount_total_ttc: selected.mount_total_ttc,
            quote_offer_id: selected.id,
          },
        });
        continue;
      }
      const available = pointOffers.filter((o) => o.total_ttc != null).length;
      items.push(
        contactItem({
          label: `${p.point_label} — remplacement pneumatique`,
          block: "mecanique",
          priority,
          detail,
          reason: available
            ? `${available} proposition(s) préparée(s) — l'opérateur doit retenir l'offre à intégrer au devis.`
            : "Donnée manquante : dimension exploitable ou tarif public actuellement indisponible.",
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
    } else {
      const it = priceBodywork(ctx, {
        elementKey: mapping.element,
        severity: priority === "urgent" ? "modere" : "leger",
        paintType: "opaque",
        priority,
      });
      items.push({
        ...it,
        originPointKey: p.point_key,
        computation: { ...it.computation, method: "calcul_carrosserie" },
      });
    }
  }
  return { ctx, vehicle, items };
}
