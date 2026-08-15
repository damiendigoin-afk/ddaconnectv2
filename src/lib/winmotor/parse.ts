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

function toRows(matrix: string[][]): ParsedFile {
  const rawHeaders = matrix[0] ?? [];
  const headers = rawHeaders.map((h, i) => (h.trim() ? h.trim() : `COL_${i + 1}`));
  const rows: RawRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r]!;
    const obj: RawRow = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]!] = (line[c] ?? "").trim();
    rows.push(obj);
  }
  return { headers, rows, delimiter: "", encoding: "" };
}

export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", raw: false, cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false }) as string[][];
    const parsed = toRows(matrix.map((r) => r.map((c) => String(c ?? ""))));
    return { ...parsed, delimiter: "xlsx", encoding: "XLSX" };
  }
  const { text, encoding } = decode(await file.arrayBuffer());
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const delimiter = detectDelimiter(firstLine);
  const parsed = toRows(parseCsv(text, delimiter));
  return { ...parsed, delimiter, encoding };
}
