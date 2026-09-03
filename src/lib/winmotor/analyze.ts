import { buildHeaderIndex, errorMessages, mapRow, type RawRow } from "./mapping";

export type Analysis = {
  fileName: string;
  totalRows: number;
  totalColumns: number;
  customers: number;
  vehicles: number;
  vins: number;
  emails: number;
  phones: number;
  registrations: number;
  mileages: number;
  duplicateVehicles: number;
  duplicateCustomers: number;
  anomalies: number;
  anomalySamples: { row: number; errors: string[] }[];
  /** Lignes valides = lignes exploitables (au moins un identifiant véhicule). */
  validRows: number;
  /** Lignes ignorées = ni immatriculation, ni VIN, ni identifiant source. */
  ignoredRows: number;
  /** Alertes qualité non bloquantes, comptées par nature. */
  alerts: { kind: AlertKind; label: string; count: number; sample: string | null }[];
  encoding: string;
  delimiter: string;
};

export type AlertKind =
  | "missing_registration"
  | "visit_future"
  | "visit_old"
  | "duplicate_key"
  | "unreachable_contact"
  | "site_mismatch";

const ALERT_LABELS: Record<AlertKind, string> = {
  missing_registration: "Immatriculation absente",
  visit_future: "Date de dernière visite dans le futur",
  visit_old: "Dernière visite de plus de 10 ans",
  duplicate_key: "Doublon immatriculation / VIN",
  unreachable_contact: "Aucun contact exploitable",
  site_mismatch: "Code site incohérent avec le reste du fichier",
};

function siteCode(row: RawRow): string {
  for (const [k, v] of Object.entries(row)) {
    const n = k
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (n.includes("code du site") || n === "site" || n.includes("code site")) return String(v ?? "").trim().toUpperCase();
  }
  return "";
}

export function analyze(
  fileName: string,
  headers: string[],
  rows: RawRow[],
  encoding: string,
  delimiter: string,
): Analysis {
  const index = buildHeaderIndex(headers);
  const vehKeys = new Set<string>();
  const custKeys = new Set<string>();
  let dupV = 0;
  let dupC = 0;
  let vins = 0;
  let emails = 0;
  let phones = 0;
  let regs = 0;
  let mileages = 0;
  let anomalies = 0;
  const samples: { row: number; errors: string[] }[] = [];

  rows.forEach((row, i) => {
    const m = mapRow(row, index);
    const vk = m.sourceVehicleId || (m.vehicle["vin_normalized"] as string) || (m.vehicle["registration_normalized"] as string) || "";
    if (vk) {
      if (vehKeys.has(vk)) dupV++;
      else vehKeys.add(vk);
    }
    const ck =
      m.sourceCustomerId ||
      [m.customer?.["last_name_normalized"], m.customer?.["first_name_normalized"], m.customer?.["company_normalized"]]
        .filter(Boolean)
        .join("|");
    if (m.customer && ck) {
      if (custKeys.has(ck)) dupC++;
      else custKeys.add(ck);
    }
    if (m.vehicle["vin_normalized"]) vins++;
    if (m.vehicle["registration_normalized"]) regs++;
    if (m.mileage) mileages++;
    emails += m.contacts.filter((c) => c.type === "EMAIL").length;
    phones += m.contacts.filter((c) => c.type !== "EMAIL").length;
    if (m.errors.length) {
      anomalies++;
      if (samples.length < 20) samples.push({ row: i + 2, errors: errorMessages(m.errors) });
    }
  });

  return {
    fileName,
    totalRows: rows.length,
    totalColumns: headers.length,
    customers: custKeys.size,
    vehicles: vehKeys.size,
    vins,
    emails,
    phones,
    registrations: regs,
    mileages,
    duplicateVehicles: dupV,
    duplicateCustomers: dupC,
    anomalies,
    anomalySamples: samples,
    encoding,
    delimiter,
  };
}
