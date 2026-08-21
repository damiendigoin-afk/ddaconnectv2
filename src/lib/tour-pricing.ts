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

type PointRow = {
  id: string;
  point_key: string;
  point_label: string;
  status: string;
  comment: string | null;
  measure_value: string | null;
};

/** Priorité déduite du statut de qualification du point. */
export function priorityFromStatus(status: string): Priority | null {
  if (status === "defect") return "urgent";
  if (status === "watch") return "a_surveiller";
  return null;
}

type Mapping =
  | { kind: "mecanique"; operation: string; label: string }
  | { kind: "carrosserie"; element: string }
  | { kind: "pneu" };

/** Correspondance point de contrôle → opération chiffrable. */
export function mapPoint(pointKey: string): Mapping | null {
  if (/^pneu_/.test(pointKey)) return { kind: "pneu" };
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
  const [{ data: points }, ctx, vehicle] = await Promise.all([
    supabase
      .from("inspection_points")
      .select("id, point_key, point_label, status, comment, measure_value")
      .eq("inspection_id", args.inspectionId)
      .order("zone_index"),
    loadEngineContext(),
    vehicleProfileForPlate(args.plate, { brand: args.brand ?? null, model: args.model ?? null }),
  ]);

  const items: PricedItem[] = [];
  for (const p of (points ?? []) as PointRow[]) {
    const priority = priorityFromStatus(p.status);
    if (!priority) continue;
    const mapping = mapPoint(p.point_key);
    const detail = p.comment ?? "";
    if (!mapping) {
      items.push(
        contactItem({
          label: p.point_label,
          block: "mecanique",
          priority,
          detail,
          reason: "Constat à qualifier par l'atelier avant chiffrage.",
        }),
      );
      continue;
    }
    if (mapping.kind === "mecanique") {
      items.push(
        priceMechanical(ctx, {
          operationCode: mapping.operation,
          label: `${p.point_label} — ${mapping.label}`,
          vehicle,
          priority,
          detail,
        }),
      );
    } else if (mapping.kind === "carrosserie") {
      items.push(
        priceBodywork(ctx, {
          elementKey: mapping.element,
          severity: priority === "urgent" ? "modere" : "leger",
          paintType: "opaque",
          priority,
        }),
      );
    } else {
      items.push(
        contactItem({
          label: `${p.point_label} — remplacement pneumatique`,
          block: "mecanique",
          priority,
          detail,
          reason:
            "Dimension homologuée et tarif fournisseur à confirmer avant proposition pneumatique.",
        }),
      );
    }
  }
  return { ctx, vehicle, items };
}
