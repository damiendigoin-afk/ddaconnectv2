/**
 * Dates véhicule (1re mise en circulation, livraison, contrôle technique) — règles pures.
 * - La date de livraison / restitution d'un OR n'est JAMAIS une MEC.
 * - Le premier CT théorique (MEC + 4 ans) ne s'applique qu'aux VP / VUL légers,
 *   et reste une date LIMITE THÉORIQUE, jamais une validité attestée.
 */

export type DateSource = "ocr_or" | "ixellio" | "manuel" | "winmotor" | "theorique";
export const DATE_SOURCE_LABEL: Record<string, string> = {
  ocr_or: "lecture OR",
  ixellio: "Ixellio",
  manuel: "saisie manuelle",
  winmotor: "WinMotor",
  theorique: "calcul théorique",
  ocr: "lecture photo CT",
  indisponible: "déclarée indisponible",
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** Date civile ISO valide (YYYY-MM-DD) ou null. Accepte JJ/MM/AAAA. */
export function isoDay(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const a = ISO.exec(s);
  const b = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (a) { y = +a[1]!; m = +a[2]!; d = +a[3]!; }
  else if (b) { y = +b[3]!; m = +b[2]!; d = +b[1]!; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const frDay = (iso: string | null | undefined) => {
  const v = isoDay(iso);
  return v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "";
};

/** Ajout d'années/mois/jours en date civile (UTC, sans fuseau). 29/02 + n ans -> 28/02. */
export function addCivil(iso: string, years = 0, months = 0, days = 0): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const ty = y + years + Math.floor((m - 1 + months) / 12);
  const tm = (((m - 1 + months) % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const dt = new Date(Date.UTC(ty, tm, Math.min(d, last)));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** Catégorie : VP/VUL léger = formule applicable ; autre catégorie connue = exclue ; inconnue = à confirmer. */
export function lightVehicleCategory(type: string | null | undefined): "light" | "excluded" | "unknown" {
  const t = String(type ?? "").trim().toUpperCase();
  if (!t || t === "-") return "unknown";
  return ["VP", "CTTE", "VUL"].includes(t) ? "light" : "excluded";
}

export type FirstCt = { limit: string; windowStart: string; label: string };

/** Premier CT théorique d'un VP/VUL : dans les 6 mois précédant le 4e anniversaire de la MEC. */
export function firstCtTheoretical(mec: string | null | undefined): FirstCt | null {
  const m = isoDay(mec);
  if (!m) return null;
  const anniversary = addCivil(m, 4);
  const limit = addCivil(anniversary, 0, 0, -1);
  const windowStart = addCivil(anniversary, 0, -6);
  const [y, mo] = [limit.slice(0, 4), Number(limit.slice(5, 7))];
  return { limit, windowStart, label: `Premier CT à réaliser avant fin ${MONTHS[mo - 1]} ${y}` };
}

export const THEORETICAL_PREFIX = "Premier CT à réaliser avant fin";

export type CtStatus =
  | { kind: "verified"; date: string; headline: string; detail: string }
  | { kind: "theoretical"; date: string; headline: string; detail: string; categoryConfirmed: boolean }
  | { kind: "missing"; date: null; headline: string; detail: string };

/**
 * Statut CT affiché (écran, aperçu client, PDF, commentaire automatique).
 * Un CT réel (PV, vignette, lecture photo confirmée, déclaration manuelle) n'est jamais remplacé par la théorie.
 */
export function ctStatus(i: {
  ctDue?: string | null;
  ctSource?: string | null;
  mec?: string | null;
  vehicleType?: string | null;
  today?: string | undefined;
}): CtStatus {
  const ct = isoDay(i.ctDue);
  if (ct && i.ctSource !== "theorique") {
    return { kind: "verified", date: ct, headline: `CT valable jusqu'au ${frDay(ct)}`, detail: "Date réelle (PV / vignette / saisie validée)." };
  }
  const cat = lightVehicleCategory(i.vehicleType);
  const first = cat !== "excluded" ? firstCtTheoretical(i.mec) : null;
  const today = isoDay(i.today) ?? new Date().toISOString().slice(0, 10);
  if (first && today <= first.limit) {
    return {
      kind: "theoretical",
      date: first.limit,
      headline: first.label,
      detail: `Date limite théorique ${frDay(first.limit)} (MEC + 4 ans, CT possible dès le ${frDay(first.windowStart)}) — non attestée par un PV${cat === "unknown" ? " ; catégorie VP/VUL à confirmer" : ""}.`,
      categoryConfirmed: cat === "light",
    };
  }
  const detail = first
    ? "Véhicule de plus de 4 ans : date réelle du dernier PV à vérifier (périodicité 2 ans)."
    : cat === "excluded" ? "Catégorie particulière : échéance à vérifier sur le PV." : "";
  return { kind: "missing", date: null, headline: "Date du contrôle technique non renseignée.", detail };
}

/**
 * Garde MEC / livraison : une MEC égale à la date de livraison, de restitution, d'entrée ou de l'OR
 * est presque toujours une confusion de lecture — elle est retirée (null), jamais conservée en silence.
 */
export function guardFirstRegistration(v: {
  first_registration?: unknown;
  delivery_date?: unknown;
  delivery_at?: unknown;
  entry_at?: unknown;
  or_date?: unknown;
  today?: string | undefined;
}): { first_registration: string | null; rejected: null | "delivery" | "order_date" | "future" | "invalid" } {
  const raw = String(v.first_registration ?? "").trim();
  if (!raw) return { first_registration: null, rejected: null };
  const mec = isoDay(raw);
  if (!mec) return { first_registration: null, rejected: "invalid" };
  const today = isoDay(v.today) ?? new Date().toISOString().slice(0, 10);
  if (mec > today) return { first_registration: null, rejected: "future" };
  if ([v.delivery_date, v.delivery_at].some((d) => isoDay(String(d ?? "").slice(0, 10)) === mec)) return { first_registration: null, rejected: "delivery" };
  if ([v.entry_at, v.or_date].some((d) => isoDay(String(d ?? "").slice(0, 10)) === mec)) return { first_registration: null, rejected: "order_date" };
  return { first_registration: mec, rejected: null };
}

const vinKey = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const txt = (v: unknown) => String(v ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]/g, "");

export type IxellioCross = {
  status: "ok" | "unavailable" | "not_found" | "skipped";
  vinMismatch: boolean;
  /** fill = MEC absente de l'OR, Ixellio la fournit ; conflict = deux MEC différentes ; same = identiques. */
  mec: "fill" | "conflict" | "same" | "none";
  ixMec: string | null;
  ixVin: string | null;
  brandMismatch: boolean;
  message: string;
};

/** Croisement lecture OR × réponse Ixellio. Un VIN divergent stoppe tout enrichissement. */
export function crossIxellio(read: { vin?: unknown; first_registration?: unknown; brand?: unknown; model?: unknown }, ix: { outcome: string; vehicle?: Record<string, string | undefined> } | null): IxellioCross {
  const none = { vinMismatch: false, mec: "none" as const, ixMec: null, ixVin: null, brandMismatch: false };
  if (!ix) return { status: "skipped", ...none, message: "Ixellio non interrogé (immatriculation non confirmée)." };
  if (ix.outcome === "auth_ok_no_vehicle") return { status: "not_found", ...none, message: "Ixellio : aucun véhicule pour cette immatriculation." };
  if (ix.outcome !== "auth_ok_vehicle_found") return { status: "unavailable", ...none, message: "Ixellio indisponible : le scan continue, MEC à saisir manuellement si besoin." };
  const v = ix.vehicle ?? {};
  const ixVin = vinKey(v["vin"]) || null;
  const ixMec = isoDay(v["dateMec"]);
  const rVin = vinKey(read.vin);
  const vinMismatch = Boolean(rVin && ixVin && rVin.length >= 11 && rVin !== ixVin);
  const rb = txt(read.brand), ib = txt(v["marque"]);
  const brandMismatch = Boolean(rb && ib && !rb.startsWith(ib) && !ib.startsWith(rb));
  const rMec = isoDay(read.first_registration);
  const mec = vinMismatch || !ixMec ? "none" : !rMec ? "fill" : rMec === ixMec ? "same" : "conflict";
  const message = vinMismatch
    ? `VIN Ixellio (${ixVin}) différent du VIN lu (${rVin}) : enrichissement stoppé, validation requise.`
    : mec === "fill" ? `MEC Ixellio : ${frDay(ixMec)}.`
    : mec === "conflict" ? `MEC lue ${frDay(rMec)} ≠ MEC Ixellio ${frDay(ixMec)} : choisissez.`
    : mec === "same" ? "MEC confirmée par Ixellio." : "Ixellio : véhicule trouvé, sans MEC.";
  return { status: "ok", vinMismatch, mec, ixMec, ixVin, brandMismatch, message };
}

/** Validation d'une saisie manuelle de dates (dialogue de correction). */
export function validateVehicleDates(p: { first_registration?: string | null; delivery_date?: string | null; ct_due_date?: string | null }, today = new Date().toISOString().slice(0, 10)): string | null {
  const mec = p.first_registration ? isoDay(p.first_registration) : null;
  const del = p.delivery_date ? isoDay(p.delivery_date) : null;
  const ct = p.ct_due_date ? isoDay(p.ct_due_date) : null;
  if (p.first_registration && !mec) return "Date de 1re mise en circulation invalide.";
  if (p.delivery_date && !del) return "Date de livraison invalide.";
  if (p.ct_due_date && !ct) return "Date de contrôle technique invalide.";
  if (mec && (mec > today || mec < "1950-01-01")) return "La 1re mise en circulation doit être passée.";
  if (del && del < "1950-01-01") return "Date de livraison invalide.";
  if (ct && mec && ct <= mec) return "L'échéance CT doit être postérieure à la mise en circulation.";
  if (ct && (ct < "2000-01-01" || ct > addCivil(today, 6))) return "Échéance CT hors plage plausible.";
  return null;
}
