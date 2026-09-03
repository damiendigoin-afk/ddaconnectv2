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
  let validRows = 0;
  const samples: { row: number; errors: string[] }[] = [];
  const alerts = new Map<AlertKind, { count: number; sample: string | null }>();
  const siteCounts = new Map<string, number>();
  const rowSites: string[] = [];

  const now = Date.now();
  const tenYears = now - 10 * 365 * 24 * 3600 * 1000;

  function alert(kind: AlertKind, sample: string) {
    const cur = alerts.get(kind);
    if (cur) {
      cur.count += 1;
      return;
    }
    alerts.set(kind, { count: 1, sample });
  }

  rows.forEach((row, i) => {
    const m = mapRow(row, index);
    const line = i + 2;
    const code = siteCode(row);
    rowSites.push(code);
    if (code) siteCounts.set(code, (siteCounts.get(code) ?? 0) + 1);

    const vk = m.sourceVehicleId || (m.vehicle["vin_normalized"] as string) || (m.vehicle["registration_normalized"] as string) || "";
    if (vk) {
      validRows++;
      if (vehKeys.has(vk)) {
        dupV++;
        alert("duplicate_key", `Ligne ${line} : clé « ${vk} » déjà rencontrée`);
      } else vehKeys.add(vk);
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
    else alert("missing_registration", `Ligne ${line} : aucune immatriculation exploitable`);
    if (m.mileage) mileages++;
    emails += m.contacts.filter((c) => c.type === "EMAIL").length;
    phones += m.contacts.filter((c) => c.type !== "EMAIL").length;
    if (m.customer && !m.contacts.length) {
      alert("unreachable_contact", `Ligne ${line} : client sans téléphone ni email`);
    }

    const visit = m.vehicle["last_visit_at"];
    if (typeof visit === "string") {
      const t = Date.parse(visit);
      if (Number.isFinite(t)) {
        if (t > now) alert("visit_future", `Ligne ${line} : visite datée du ${visit.slice(0, 10)}`);
        else if (t < tenYears) alert("visit_old", `Ligne ${line} : visite datée du ${visit.slice(0, 10)}`);
      }
    }

    if (m.errors.length) {
      anomalies++;
      if (samples.length < 20) samples.push({ row: line, errors: errorMessages(m.errors) });
    }
  });

  // Site incohérent : code minoritaire dans un fichier très majoritairement mono-site.
  if (siteCounts.size > 1) {
    const sorted = [...siteCounts.entries()].sort((a, b) => b[1] - a[1]);
    const [mainCode, mainCount] = sorted[0]!;
    if (mainCount / rows.length >= 0.8) {
      const odd = rowSites.findIndex((c) => c && c !== mainCode);
      const minority = rows.length - mainCount;
      alerts.set("site_mismatch", {
        count: minority,
        sample: odd >= 0 ? `Ligne ${odd + 2} : site « ${rowSites[odd]} » alors que le fichier est « ${mainCode} »` : null,
      });
    }
  }

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
    validRows,
    ignoredRows: rows.length - validRows,
    alerts: [...alerts.entries()].map(([kind, v]) => ({
      kind,
      label: ALERT_LABELS[kind],
      count: v.count,
      sample: v.sample,
    })),
    encoding,
    delimiter,
  };
}
