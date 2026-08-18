/** Lecture d'un export Winmotor côté navigateur : CSV (`;` / CP1252) ou XLSX. */
import type { RawRow } from "./mapping";

export type ParsedFile = { headers: string[]; rows: RawRow[]; delimiter: string; encoding: string };

function decode(buf: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buf);
  // BOM UTF-8
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
  }
  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    return { text: strict.decode(bytes), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}

function detectDelimiter(firstLine: string): string {
  const candidates = [";", "\t", ",", "|"];
  let best = ";";
  let max = -1;
  for (const c of candidates) {
    const n = firstLine.split(c).length;
    if (n > max) {
      max = n;
      best = c;
    }
  }
  return best;
}

/** Parseur CSV tolérant : guillemets, retours à la ligne dans les champs, champs vides. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Mots-clés d'en-tête attendus dans les exports atelier (Winmotor, Suivi Missions…). */
const HEADER_HINTS = [
  "immat",
  "client",
  "vehicule",
  "marque",
  "modele",
  "date",
  "sinistre",
  "mission",
  "assur",
  "expert",
  "montant",
  "vin",
  "chassis",
  "or",
  "telephone",
  "email",
];

const STRONG_HEADER_HINTS = [
  /^(n |no |numero )?immat(riculation)?( vehicule)?$/,
  /^(nom )?client$/,
  /^(marque |type )?vehicule$/,
  /^(date )?mission$/,
  /^(n |no |numero )?(or|sinistre|mission)$/,
  /^(assureur|assurance|expert|vin|chassis)$/,
];

function normHeader(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Les fichiers réels commencent souvent par un titre / des lignes vides : on cherche la vraie ligne d'en-tête. */
export function findHeaderRow(matrix: string[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(matrix.length, 15);
  for (let r = 0; r < limit; r++) {
    const cells = (matrix[r] ?? []).map((c) => normHeader(String(c ?? "")));
    const filled = cells.filter((c) => c !== "").length;
    if (filled < 2) continue;
    const strong = cells.filter((c) => c && STRONG_HEADER_HINTS.some((h) => h.test(c))).length;
    const hints = cells.filter((c) => c && HEADER_HINTS.some((h) => c === h || c.startsWith(`${h} `))).length;
    const score = strong * 100 + hints * 10 + filled;
    if (hints > 0 && score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (bestScore < 0) best = matrix.findIndex((r) => (r ?? []).some((c) => String(c ?? "").trim() !== ""));
  return best < 0 ? 0 : best;
}

function toRows(matrix: string[][]): ParsedFile {
  const headerRow = findHeaderRow(matrix);
  const rawHeaders = matrix[headerRow] ?? [];
  const headers = rawHeaders.map((h, i) => {
    const cleaned = h.replace(/\u00a0/g, " ").trim();
    return cleaned || `COL_${i + 1}`;
  });
  const rows: RawRow[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const line = matrix[r]!;
    const obj: RawRow = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]!] = String(line[c] ?? "");
    if (Object.values(obj).some((value) => value.trim() !== "")) rows.push(obj);
  }
  return { headers, rows, delimiter: "", encoding: "" };
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: false });
    const candidates = wb.SheetNames.map((sheetName) => {
      const sheet = wb.Sheets[sheetName];
      if (!sheet) return { matrix: [] as string[][], score: -1 };
      const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false }) as string[][];
      const clean = matrix.map((r) => r.map((c) => String(c ?? "")));
      const header = clean[findHeaderRow(clean)] ?? [];
      const score = header.map(normHeader).filter((c) => STRONG_HEADER_HINTS.some((h) => h.test(c))).length;
      return { matrix: clean, score };
    });
    const selected = candidates.sort((a, b) => b.score - a.score)[0];
    const parsed = toRows(selected?.matrix ?? []);
    return { ...parsed, delimiter: "xlsx", encoding: "XLSX" };
  }
  const { text, encoding } = decode(await file.arrayBuffer());
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const delimiter = detectDelimiter(firstLine);
  const parsed = toRows(parseCsv(text, delimiter));
  return { ...parsed, delimiter, encoding };
}
