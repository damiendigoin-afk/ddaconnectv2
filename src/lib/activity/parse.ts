/**
 * Import déterministe des tableaux de suivi mensuel Excel (aucune IA, aucun OCR).
 * Détection société par en-tête, mois par onglet, valeurs par libellé normalisé.
 */
import { indicatorForLabel, normLabel, type Indicator } from "./indicators";

export type SiteCode = "dda" | "castillon";

export const SITE_LABELS: Record<SiteCode, string> = {
  dda: "DDA / Lalinde",
  castillon: "Castillon",
};

const COMPANY_SIGNATURES: { norm: string; site: SiteCode }[] = [
  { norm: "SASDAMIENDIGOINAUTOMOBILE", site: "dda" },
  { norm: "DAMIENDIGOINAUTOMOBILE", site: "dda" },
  { norm: "SASCASTILLONVEYSSIERE", site: "castillon" },
  { norm: "CASTILLONVEYSSIERE", site: "castillon" },
];

export type Anomaly = {
  kind: "missing" | "unknown";
  site: string;
  sheet: string;
  section: string;
  label: string;
  message: string;
};

export type ParsedMonth = {
  sheet: string;
  periodStart: string;
  values: Record<string, number | null>;
  recognized: number;
};

export type ParsedWorkbook = {
  site: SiteCode;
  months: ParsedMonth[];
  anomalies: Anomaly[];
  /** Nombre total de valeurs numériques enregistrées. */
  valuesCount: number;
  /** Onglets ignorés (mois non identifiable). */
  skippedSheets: string[];
};

export class ImportError extends Error {}

/** Détection société à partir du contenu des cellules ; le nom de fichier n'est qu'un contrôle. */
export function detectSite(rows: unknown[][]): SiteCode | null {
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const n = normLabel(cell);
      if (!n) continue;
      const hit = COMPANY_SIGNATURES.find((s) => n.includes(s.norm));
      if (hit) return hit.site;
    }
  }
  return null;
}

const MONTH_WORDS = [
  "JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN",
  "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE",
];

function isoMonth(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
}

/** Mois d'un onglet : d'abord le nom (DDA0826 / CASTI0826), sinon un libellé « Août 2026 ». */
export function detectMonth(sheetName: string, rows: unknown[][]): string | null {
  const m = /(\d{2})(\d{2})\s*$/.exec(sheetName.trim());
  if (m) {
    const mm = Number(m[1]);
    const yy = Number(m[2]);
    if (mm >= 1 && mm <= 12) return isoMonth(2000 + yy, mm - 1);
  }
  for (const row of rows.slice(0, 12)) {
    for (const cell of row) {
      if (typeof cell !== "string") continue;
      const n = normLabel(cell);
      const idx = MONTH_WORDS.findIndex((w) => n.includes(w));
      if (idx >= 0) {
        const y = /(\d{4})/.exec(cell);
        if (y) return isoMonth(Number(y[1]), idx);
      }
    }
  }
  return null;
}

/** Conversion stricte : cellule vide → null (jamais 0), « 1 234,56 € » → 1234.56. */
export function toNumber(cell: unknown): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== "string") return null;
  const raw = cell.trim();
  if (!raw) return null;
  const percent = raw.includes("%");
  const cleaned = raw
    .replace(/[€%\s\u00a0]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  if (!/^-?\(?\d*\.?\d+\)?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("(") && cleaned.endsWith(")");
  const n = Number(negative ? cleaned.slice(1, -1) : cleaned);
  if (!Number.isFinite(n)) return null;
  const signed = negative ? -n : n;
  return percent ? signed / 100 : signed;
}

function labelCell(row: unknown[]): { label: string; index: number } | null {
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (typeof c === "string" && normLabel(c).length > 1) return { label: c.trim(), index: i };
    if (typeof c === "number") return null; // ligne purement chiffrée
  }
  return null;
}

function firstValue(row: unknown[], from: number): { value: number | null; found: boolean } {
  for (let i = from; i < row.length; i++) {
    const cell = row[i];
    if (cell === null || cell === undefined || (typeof cell === "string" && !cell.trim())) continue;
    const n = toNumber(cell);
    if (n !== null) return { value: n, found: true };
    return { value: null, found: false };
  }
  return { value: null, found: false };
}

/** Analyse d'un onglet mensuel déjà converti en tableau de cellules. */
export function parseSheet(
  sheetName: string,
  rows: unknown[][],
  site: SiteCode,
): { month: ParsedMonth | null; anomalies: Anomaly[] } {
  const anomalies: Anomaly[] = [];
  const periodStart = detectMonth(sheetName, rows);
  if (!periodStart) return { month: null, anomalies };

  const values: Record<string, number | null> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const head = labelCell(row);
    if (!head) continue;
    const indicator: Indicator | null = indicatorForLabel(head.label);
    const { value, found } = firstValue(row, head.index + 1);
    if (!indicator) continue;
    if (seen.has(indicator.key)) continue;
    seen.add(indicator.key);
    values[indicator.key] = found ? value : null;
    if (!found) {
      anomalies.push({
        kind: "missing",
        site: SITE_LABELS[site],
        sheet: sheetName,
        section: indicator.section,
        label: indicator.label,
        message: `${SITE_LABELS[site]} → ${sheetName} → ${indicator.label} : valeur manquante`,
      });
    }
  }

  const recognized = Object.values(values).filter((v) => v !== null).length;
  return { month: { sheet: sheetName, periodStart, values, recognized }, anomalies };
}

/** Analyse complète d'un classeur : plusieurs onglets mensuels d'une même société. */
export function parseWorkbookSheets(sheets: { name: string; rows: unknown[][] }[]): ParsedWorkbook {
  const detected = new Set<SiteCode>();
  for (const s of sheets) {
    const site = detectSite(s.rows);
    if (site) detected.add(site);
  }
  if (detected.size === 0) {
    throw new ImportError(
      "Société non reconnue : aucun en-tête « SAS DAMIEN DIGOIN AUTOMOBILE » ou « SAS CASTILLON-VEYSSIERE » trouvé dans le fichier.",
    );
  }
  if (detected.size > 1) {
    throw new ImportError("Fichier incohérent : deux sociétés différentes détectées dans le même classeur.");
  }
  const site = [...detected][0] as SiteCode;

  const months: ParsedMonth[] = [];
  const anomalies: Anomaly[] = [];
  const skippedSheets: string[] = [];
  for (const s of sheets) {
    const res = parseSheet(s.name, s.rows, site);
    if (!res.month) {
      skippedSheets.push(s.name);
      continue;
    }
    if (res.month.recognized === 0) {
      skippedSheets.push(s.name);
      continue;
    }
    months.push(res.month);
    anomalies.push(...res.anomalies);
  }

  if (!months.length) throw new ImportError("Aucun onglet mensuel exploitable n'a été reconnu dans ce fichier.");

  months.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const valuesCount = months.reduce((acc, m) => acc + Object.keys(m.values).length, 0);
  return { site, months, anomalies, valuesCount, skippedSheets };
}

/** Lecture navigateur d'un fichier Excel/CSV : conversion en tableaux de cellules bruts. */
export async function readWorkbook(file: File): Promise<{ name: string; rows: unknown[][] }[]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name] as never, { header: 1, blankrows: false, raw: true }) as unknown[][],
  }));
}
