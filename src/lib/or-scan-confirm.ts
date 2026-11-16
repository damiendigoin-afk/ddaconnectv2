/**
 * Résolution pure de l'écran de vérification du scan OR (OrScanConfirm) : tous les champs retenus
 * (VIN, MEC inclus) sont appliqués AVANT le recalcul des doutes ; le choix de source VIN et
 * l'arbitrage MEC (radio ou saisie manuelle valide) ne passent jamais par la case générique,
 * réservée aux doutes plaque/client/marque-modèle.
 */
import { assessOrScan, checkPlate, type OrScanData, type OrScanDoubt } from "./or-scan-validate";
import { formatPlate } from "./plate";
import { isoDay, type IxellioCross, type VehicleSourceChoice } from "./vehicle-dates";
import { normalizeVin, vinIssueMessage } from "./vin";

export const OR_CONFIRM_FIELDS: Array<{ key: string; group: "vehicle" | "client"; label: string; doubt: OrScanDoubt["field"] | null; numeric?: boolean }> = [
  { key: "plate", group: "vehicle", label: "Immatriculation", doubt: "plate" },
  { key: "brand", group: "vehicle", label: "Marque", doubt: "brand" },
  { key: "model", group: "vehicle", label: "Modèle", doubt: "model" },
  { key: "mileage", group: "vehicle", label: "Kilométrage", doubt: null, numeric: true },
  { key: "last_name", group: "client", label: "Nom client", doubt: "client" },
  { key: "first_name", group: "client", label: "Prénom", doubt: "client" },
];

export type OrConfirmState = {
  vals: Record<string, string>;
  checked: boolean;
  vin: string;
  vinSource: string;
  vinEdited: boolean;
  source: "" | VehicleSourceChoice;
  mec: string;
  mecSource: string;
  mecChoice: "" | "or" | "ixellio" | "none";
  delivery: string;
};

export type OrConfirmInput = { data: OrScanData; doubts: OrScanDoubt[]; orNumber: string | null; ix: IxellioCross | null };

/** Doutes qui relèvent de la case « J'ai vérifié » (jamais VIN ni dates). */
export const isGenericDoubt = (d: OrScanDoubt) => (d.blocking || d.code === "plate_two_readings") && (d.code === "vin_invalid" || (d.field !== "vin" && d.field !== "first_registration"));

export function resolveOrConfirm(p: OrConfirmInput, s: OrConfirmState, today = new Date().toISOString().slice(0, 10)):
  { ok: true; data: OrScanData } | { ok: false; error: string; needsCheck?: boolean } {
  const ix = p.ix;
  const vehicle: Record<string, unknown> = { ...p.data.vehicle };
  const client: Record<string, unknown> = { ...p.data.client };
  for (const f of OR_CONFIRM_FIELDS) {
    const v = (s.vals[`${f.group}.${f.key}`] ?? "").trim();
    const t = f.group === "vehicle" ? vehicle : client;
    if (v) t[f.key] = f.numeric ? v.replace(/\D/g, "") : f.key === "plate" ? formatPlate(v) : v; else delete t[f.key];
  }
  const plateEdited = String(vehicle["plate"] ?? "") !== String(p.data.vehicle["plate"] ?? "");
  if (checkPlate(vehicle["plate"], { orNumber: p.orNumber, account: client["account_number"] }) === "or_number") return { ok: false, error: "Ce numéro est le n° d'OR, pas une immatriculation." };
  // 1) Choix de source / arbitrage MEC.
  if (ix?.vinMismatch && !s.source) return { ok: false, error: "VIN différent entre le scan et Ixellio : choisissez la source à utiliser." };
  const mecManual = s.mecSource === "manuel" && !!isoDay(s.mec) && s.mec !== p.data.vehicle["first_registration"];
  if (ix?.mec === "conflict" && !ix.vinMismatch && !s.mecChoice && !mecManual) return { ok: false, error: "MEC différente entre le scan et Ixellio : choisissez une source ou saisissez la MEC." };
  if (plateEdited && s.mecSource === "ixellio") return { ok: false, error: "Immatriculation modifiée : la MEC Ixellio concerne l'ancienne plaque. Saisissez la MEC ou videz-la." };
  // 2) VIN retenu.
  const vinN = normalizeVin(s.vin);
  if (s.vinEdited && vinN.candidate && !vinN.vin) return { ok: false, error: vinIssueMessage(vinN) ?? "VIN invalide." };
  if (vinN.candidate) {
    vehicle["vin"] = vinN.vin ?? vinN.candidate;
    vehicle["vin_source"] = s.vinEdited ? "manuel" : s.vinSource;
    const raw = String(p.data.vehicle["vin_ocr_raw"] ?? p.data.vehicle["vin"] ?? "").trim();
    if (raw && raw !== vehicle["vin"]) vehicle["vin_ocr_raw"] = raw; else delete vehicle["vin_ocr_raw"];
  } else { delete vehicle["vin"]; delete vehicle["vin_source"]; }
  // 3) Dates retenues.
  if (s.mec && !isoDay(s.mec)) return { ok: false, error: "Date de 1re MEC invalide." };
  if (s.mec && s.delivery && s.mec === s.delivery) return { ok: false, error: "La 1re MEC ne peut pas être la date de livraison : corrigez ou videz la MEC." };
  if (s.mec && s.mec > today) return { ok: false, error: "La 1re MEC ne peut pas être future." };
  if (s.mec) { vehicle["first_registration"] = s.mec; vehicle["first_registration_source"] = s.mecSource; } else { vehicle["first_registration"] = null; delete vehicle["first_registration_source"]; }
  if (s.delivery) vehicle["delivery_date"] = s.delivery; else delete vehicle["delivery_date"];
  // 4) Recalcul des doutes sur les valeurs finales ; seuls plaque/client/marque-modèle exigent la case.
  const again = assessOrScan({ data: { ...p.data, vehicle, client }, orNumber: p.orNumber });
  const plateDoubtLeft = !plateEdited && p.doubts.some((d) => d.code === "plate_two_readings");
  if ((again.doubts.some(isGenericDoubt) || plateDoubtLeft) && !s.checked) return { ok: false, error: "Corrigez les valeurs signalées ou cochez « J'ai vérifié ces valeurs ».", needsCheck: true };
  const out = { ...again.data.vehicle };
  if (s.checked && checkPlate(out["plate"]) === "atypical") out["plate_confirmed"] = true;
  return { ok: true, data: { ...again.data, vehicle: out } };
}
