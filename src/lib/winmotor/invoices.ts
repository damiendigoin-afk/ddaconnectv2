/**
 * Exports WinMotor « Entêtes de factures » et « Détail facturation » (CSV `;`).
 * Pur (aucune dépendance réseau) : lecture, mapping de colonnes, rejets contrôlés, regroupement par facture.
 * Montants HT. `En-tête forfait` = titre (ni CA ni heures). Dernier km = dernier connu, jamais historique.
 */
import { normalizeEmail, normalizePhone, normalizeRegistration, normalizeVin, normHeader, parseDate } from "./mapping";

export type ImportKind = "headers" | "details";

// ---------- Décodage / découpage ----------
export function decodeBuffer(buf: ArrayBuffer | Uint8Array): { text: string; encoding: string } {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8 (BOM)" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}

/** Itère les enregistrements (guillemets pris en compte, y compris retours à la ligne entre guillemets). */
export function* iterRecords(text: string, delim = ";"): Generator<{ fields: string[]; raw: string; lineNo: number }> {
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let start = 0;
  let lineNo = 1;
  let recLine = 1;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : "\n";
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        if (ch === "\n") lineNo++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") { quoted = true; continue; }
    if (ch === delim) { fields.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") {
      fields.push(field);
      const raw = text.slice(start, Math.min(i, text.length)).replace(/\r$/, "");
      if (raw.trim() !== "" || i < text.length) {
        if (raw.trim() !== "") yield { fields, raw, lineNo: recLine };
      }
      fields = []; field = ""; start = i + 1; lineNo++; recLine = lineNo;
      continue;
    }
    field += ch;
  }
}

// ---------- Nombres ----------
export function parseAmount(v: string | undefined): number | null {
  const s = (v ?? "").trim().replace(/\s|\u00a0|€/g, "");
  if (!s) return null;
  let t = s;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, "");
  t = t.replace(",", ".");
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`;
  if (/^\d+(\.\d+)?-$/.test(t)) t = `-${t.slice(0, -1)}`;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const isNumOrEmpty = (v: string | undefined) => !(v ?? "").trim() || parseAmount(v) !== null;

// ---------- Mapping de colonnes ----------
type Alias = { exact: string[]; contains?: string[][]; not?: string[] };
const A = (exact: string[], contains?: string[][], not?: string[]): Alias => ({ exact, ...(contains ? { contains } : {}), ...(not ? { not } : {}) });

const COMMON: Record<string, Alias> = {
  inv: A(["Numero facture", "N facture", "No facture", "Num facture", "Facture", "N° facture", "Numero de facture"], [["FACTURE", "NUM"], ["FACTURE", "NO"]], ["CLIENT", "DATE", "TYPE"]),
  date: A(["Date facture", "Date de facture", "Date"], [["DATE", "FACTURE"]], ["VISITE", "CIRCULATION", "MEC"]),
  or: A(["Numero OR", "N OR", "No OR", "OR", "Numero dossier", "N dossier", "Dossier", "Ordre de reparation", "Numero ordre"], [["DOSSIER"], ["ORDRE"]]),
  client_no: A(["Numero client", "N client", "No client", "Code client", "Client", "Compte client"], [["CLIENT", "NUM"], ["CLIENT", "CODE"]], ["FACTURE", "NOM", "PRENOM"]),
  client_name: A(["Nom client", "Nom du client", "Nom", "Raison sociale", "Client nom"], [["NOM", "CLIENT"]], ["FACTURE", "PRENOM"]),
  client_first: A(["Prenom", "Prenom client"], [["PRENOM"]], ["FACTURE"]),
  billed_no: A(["Numero client facture", "N client facture", "Code client facture", "Client facture", "Numero client facturé", "Code payeur", "Payeur"], [["CLIENT", "FACTURE"], ["PAYEUR"]], ["NOM"]),
  billed_name: A(["Nom client facture", "Nom client facturé", "Nom payeur"], [["NOM", "FACTURE"], ["NOM", "PAYEUR"]]),
  plate: A(["Immatriculation", "Immat", "Plaque"], [["IMMAT"]]),
  vin: A(["VIN", "Numero de serie", "N serie", "Chassis", "Numero chassis"], [["SERIE"], ["CHASSIS"], ["VIN"]]),
  doc_type: A(["Type facture", "Type document", "Type de facture", "Nature"], [["TYPE", "FACTURE"], ["TYPE", "DOC"]]),
};
const DETAIL: Record<string, Alias> = {
  ...COMMON,
  activity: A(["Activite", "Code activite"], [["ACTIVITE"]]),
  line_type: A(["Type de ligne", "Type ligne", "Type"], [["TYPE", "LIGNE"]], ["FACTURE", "DOC", "MINE"]),
  ref: A(["Reference", "Ref", "Code article", "Reference article", "Ref article"], [["REF"]], ["CLIENT", "FACTURE"]),
  designation: A(["Libelle", "Designation", "Libelle ligne"], [["LIBELLE"], ["DESIGNATION"]]),
  qty: A(["Quantite", "Qte", "Qté"], [["QUANT"], ["QTE"]]),
  unit: A(["Prix unitaire HT", "PU HT", "Prix unitaire", "Prix HT"], [["PRIX", "UNIT"]]),
  discount: A(["Remise", "Taux remise", "Remise %"], [["REMISE"]]),
  net: A(["Total net HT", "Montant net HT", "Net HT", "Total HT", "Montant HT", "Total ligne HT"], [["NET", "HT"], ["TOTAL", "HT"], ["MONTANT", "HT"]]),
  vat_code: A(["Code TVA", "TVA"], [["TVA"]]),
  family: A(["Famille", "Code famille", "Famille article"], [["FAMILLE"]]),
  manufacturer: A(["Fabricant", "Marque article", "Constructeur"], [["FABRIC"]]),
};
const HEADER: Record<string, Alias> = {
  ...COMMON,
  address: A(["Adresse", "Adresse client"], [["ADRESSE"]], ["MAIL"]),
  postal_code: A(["Code postal", "CP"], [["POSTAL"]]),
  city: A(["Ville", "Localite"], [["VILLE"]]),
  phone: A(["Telephone", "Tel", "Telephone fixe"], [["TEL"]], ["PORT", "MOBILE"]),
  mobile: A(["Portable", "Mobile", "Tel portable", "Telephone portable"], [["PORT"], ["MOBILE"]]),
  email: A(["Email", "E-mail", "Mail", "Adresse mail"], [["MAIL"]]),
  brand: A(["Marque"], [["MARQUE"]]),
  range: A(["Gamme"], [["GAMME"]]),
  model: A(["Modele"], [["MODELE"]]),
  type_mine: A(["Type mine", "Type MINE"], [["MINE"]]),
  mec: A(["Date mise en circulation", "Date de mise en circulation", "MEC", "Date MEC", "1ere mise en circulation"], [["CIRCULATION"], ["MEC"]]),
  last_km: A(["Dernier km au compteur", "Dernier km", "Kilometrage"], [["KM"], ["KILOM"]]),
  last_visit: A(["Date de derniere visite", "Date derniere visite", "Derniere visite"], [["VISITE"]]),
  warranty: A(["Garantie", "Garanties"], [["GARANTIE"]]),
  total_ht: A(["Total HT", "Montant HT", "Total facture HT"], [["TOTAL", "HT"]], ["TTC"]),
  total_tva: A(["Total TVA", "Montant TVA", "TVA"], [["TVA"]], ["CODE", "TTC"]),
  total_ttc: A(["Total TTC", "Montant TTC", "Net a payer"], [["TTC"]]),
  seller: A(["Vendeur", "Commercial", "Receptionnaire"], [["VENDEUR"]]),
};

export type ColumnMap = Record<string, number>;

export function resolveColumns(headers: string[], kind: ImportKind): { map: ColumnMap; missing: string[] } {
  const spec = kind === "details" ? DETAIL : HEADER;
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const map: ColumnMap = {};
  // 1) correspondances exactes (toutes les clés), 2) « contient » avec exclusions.
  for (const [key, a] of Object.entries(spec)) {
    const idx = norm.findIndex((h, i) => !used.has(i) && a.exact.some((e) => normHeader(e) === h));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  for (const [key, a] of Object.entries(spec)) {
    if (map[key] !== undefined || !a.contains) continue;
    const idx = norm.findIndex((h, i) => !used.has(i) && a.contains!.some((parts) => parts.every((p) => h.includes(p))) && !(a.not ?? []).some((n) => h.includes(n)));
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  const required = kind === "details" ? ["inv", "net"] : ["inv"];
  return { map, missing: required.filter((k) => map[k] === undefined) };
}

export function detectKind(headers: string[]): ImportKind | null {
  const n = headers.map(normHeader).join("|");
  if (/LIBELLE|DESIGNATION/.test(n) && /QUANT|QTE/.test(n)) return "details";
  if (/TTC/.test(n) || /DERNIERKM|VISITE/.test(n)) return "headers";
  return null;
}

// ---------- Lignes malformées ----------
const KNOWN_LINE_TYPE = /PIECE|MAIN|OEUVRE|FORFAIT|^MO$|TEXTE|COMMENT|FRAIS|DIVERS|ARTICLE|PRESTATION|SOUSTRAIT|LIBELLE/;
/**
 * `;` non échappé dans un libellé : reconstruction uniquement si UNE seule colonne texte permet
 * d'obtenir une ligne cohérente (numériques valides). Sinon rejet avec texte brut.
 */
export function recoverFields(fields: string[], expected: number, map: ColumnMap): { fields: string[] | null; reason?: string } {
  if (fields.length === expected) return { fields };
  if (fields.length < expected) return { fields: null, reason: `Colonnes manquantes (${fields.length}/${expected})` };
  const extra = fields.length - expected;
  const textCols = ["designation", "client_name", "billed_name", "address"].map((k) => map[k]).filter((v): v is number => v !== undefined);
  const numCols = ["qty", "unit", "net", "discount", "total_ht", "total_tva", "total_ttc"].map((k) => map[k]).filter((v): v is number => v !== undefined);
  const dateCol = map["date"];
  const ok: string[][] = [];
  for (const c of textCols) {
    const cand = [...fields.slice(0, c), fields.slice(c, c + extra + 1).join(";"), ...fields.slice(c + extra + 1)];
    if (cand.length !== expected) continue;
    if (!numCols.every((i) => isNumOrEmpty(cand[i]))) continue;
    if (dateCol !== undefined && cand[dateCol]?.trim() && !parseDate(cand[dateCol]!)) continue;
    const vc = map["vat_code"] !== undefined ? (cand[map["vat_code"]!] ?? "").trim() : "";
    if (vc && !/^\d{1,2}$/.test(vc)) continue;
    const lt = map["line_type"] !== undefined ? (cand[map["line_type"]!] ?? "").trim() : "";
    if (lt && !KNOWN_LINE_TYPE.test(normHeader(lt.replace(/œ/gi, "oe")))) continue;
    ok.push(cand);
  }
  if (ok.length === 1) return { fields: ok[0]! };
  return { fields: null, reason: ok.length ? "Ligne ambiguë (plusieurs reconstructions possibles)" : `Colonnes en trop (${fields.length}/${expected}) — reconstruction impossible` };
}

// ---------- Sémantique des lignes ----------
export type LineKind = "package_header" | "part" | "package_part" | "labour" | "package_labour" | "other";

export function classifyLine(lineType: string): { kind: LineKind; rev: boolean; hours: boolean } {
  const t = normHeader(lineType.replace(/œ/gi, "oe"));
  const forfait = t.includes("FORFAIT");
  if (t.includes("ENTETE") && forfait) return { kind: "package_header", rev: false, hours: false };
  if (t.includes("MAIN") || t.includes("OEUVRE") || t === "MO") return { kind: forfait ? "package_labour" : "labour", rev: true, hours: true };
  if (t.includes("PIECE")) return { kind: forfait ? "package_part" : "part", rev: true, hours: false };
  return { kind: "other", rev: true, hours: false };
}

export const DEFAULT_VAT: Record<string, number> = { "0": 0, "2": 20, "8": 20 };
export function vatRate(code: string | null | undefined, table: Record<string, number> = DEFAULT_VAT): number | null {
  const c = (code ?? "").trim();
  return c && table[c] !== undefined ? table[c]! : null;
}

export function docKind(typeText: string, total: number | null): "invoice" | "credit" | "preinvoice" {
  const t = normHeader(typeText);
  if (t.includes("PREFACT") || t.includes("PROFORMA")) return "preinvoice";
  if (t.includes("AVOIR")) return "credit";
  if (total != null && total < 0) return "credit";
  return "invoice";
}

/** Hash déterministe court (cyrb53) pour la détection de changement de contenu. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const refNorm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---------- Construction ----------
export type DetailLine = { seq: number; activity: string; line_type: string; kind: LineKind; rev: boolean; hours: boolean; ref: string; ref_n: string; designation: string; qty: number | null; unit: number | null; discount: number | null; net: number | null; vat_code: string; vat_rate: number | null; family: string; extra: Record<string, string> | null };
export type DetailInvoice = { inv: string; date: string | null; or: string; client_no: string; client_name: string; billed_no: string; billed_name: string; plate: string; plate_n: string; vin: string; vin_n: string; doc_kind: string; lines: DetailLine[]; lines_hash: string; net_ht: number; hours: number };
export type HeaderRow = Record<string, unknown> & { inv: string; date: string | null; total_ht: number | null; total_ttc: number | null; hash: string };
export type Reject = { line_no: number; reason: string; raw_text: string };

export type ParseResult = {
  kind: ImportKind;
  encoding: string;
  headers: string[];
  map: ColumnMap;
  missing: string[];
  rowsTotal: number;
  recovered: number;
  rejects: Reject[];
  dateMin: string | null;
  dateMax: string | null;
  invoices: DetailInvoice[];
  headerRows: HeaderRow[];
  orCount: number;
  negativeRows: number;
  sumHt: number;
  sumTtc: number;
  duplicateInvoiceRows: number;
};

export function parseExport(text: string, kind: ImportKind | null, encoding = "UTF-8", vat: Record<string, number> = DEFAULT_VAT): ParseResult {
  const it = iterRecords(text, ";");
  const first = it.next();
  const headers = first.done ? [] : first.value.fields.map((h) => h.trim());
  const k: ImportKind = kind ?? detectKind(headers) ?? "details";
  const { map, missing } = resolveColumns(headers, k);
  const res: ParseResult = { kind: k, encoding, headers, map, missing, rowsTotal: 0, recovered: 0, rejects: [], dateMin: null, dateMax: null, invoices: [], headerRows: [], orCount: 0, negativeRows: 0, sumHt: 0, sumTtc: 0, duplicateInvoiceRows: 0 };
  if (missing.length) return res;
  const g = (f: string[], key: string) => (map[key] !== undefined ? (f[map[key]!] ?? "").trim() : "");
  const byInv = new Map<string, DetailInvoice>();
  const seenHeader = new Map<string, HeaderRow>();
  const ors = new Set<string>();
  const mapped = new Set(Object.values(map));

  for (const rec of it) {
    res.rowsTotal++;
    const r = recoverFields(rec.fields, headers.length, map);
    if (!r.fields) { res.rejects.push({ line_no: rec.lineNo, reason: r.reason ?? "Ligne illisible", raw_text: rec.raw.slice(0, 2000) }); continue; }
    if (r.fields !== rec.fields) res.recovered++;
    const f = r.fields;
    const inv = g(f, "inv");
    if (!inv) { res.rejects.push({ line_no: rec.lineNo, reason: "N° de facture absent", raw_text: rec.raw.slice(0, 2000) }); continue; }
    const date = parseDate(g(f, "date"));
    if (date) { if (!res.dateMin || date < res.dateMin) res.dateMin = date; if (!res.dateMax || date > res.dateMax) res.dateMax = date; }
    const or = g(f, "or");
    if (or) ors.add(or);
    const plate = g(f, "plate");
    const vin = g(f, "vin");

    if (k === "details") {
      const lineType = g(f, "line_type");
      const cls = classifyLine(lineType);
      const net = parseAmount(g(f, "net"));
      const qty = parseAmount(g(f, "qty"));
      if ((net ?? 0) < 0 || (qty ?? 0) < 0) res.negativeRows++;
      if (cls.rev && net) res.sumHt += net;
      const ref = g(f, "ref");
      const extra: Record<string, string> = {};
      headers.forEach((h, i) => { if (!mapped.has(i) && (f[i] ?? "").trim()) extra[h] = f[i]!.trim(); });
      let invObj = byInv.get(inv);
      if (!invObj) {
        invObj = { inv, date, or, client_no: g(f, "client_no"), client_name: [g(f, "client_name"), g(f, "client_first")].filter(Boolean).join(" "), billed_no: g(f, "billed_no"), billed_name: g(f, "billed_name"), plate, plate_n: normalizeRegistration(plate), vin, vin_n: normalizeVin(vin), doc_kind: docKind(g(f, "doc_type"), null), lines: [], lines_hash: "", net_ht: 0, hours: 0 };
        byInv.set(inv, invObj);
      }
      const vc = g(f, "vat_code");
      invObj.lines.push({ seq: invObj.lines.length + 1, activity: g(f, "activity"), line_type: lineType, ...cls, ref, ref_n: refNorm(ref), designation: g(f, "designation"), qty, unit: parseAmount(g(f, "unit")), discount: parseAmount(g(f, "discount")), net, vat_code: vc, vat_rate: vatRate(vc, vat), family: g(f, "family"), extra: Object.keys(extra).length ? extra : null });
    } else {
      const total_ht = parseAmount(g(f, "total_ht"));
      const total_ttc = parseAmount(g(f, "total_ttc"));
      if ((total_ht ?? 0) < 0) res.negativeRows++;
      const lastKm = parseAmount(g(f, "last_km"));
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => { if ((f[i] ?? "").trim()) raw[h] = f[i]!.trim(); });
      const clientLast = g(f, "client_name");
      const row: HeaderRow = {
        inv, date, or, doc_kind: docKind(g(f, "doc_type"), total_ttc ?? total_ht),
        client_no: g(f, "client_no"), client_last: clientLast, client_first: g(f, "client_first"), client_name: [clientLast, g(f, "client_first")].filter(Boolean).join(" "),
        billed_no: g(f, "billed_no"), billed_name: g(f, "billed_name"),
        phone: g(f, "phone"), phone_n: normalizePhone(g(f, "phone")), mobile: g(f, "mobile"), mobile_n: normalizePhone(g(f, "mobile")), email: normalizeEmail(g(f, "email")),
        plate, plate_n: normalizeRegistration(plate), vin, vin_n: normalizeVin(vin), brand: g(f, "brand"), range: g(f, "range"), model: g(f, "model"), type_mine: g(f, "type_mine"), mec: parseDate(g(f, "mec")),
        last_km: lastKm != null && lastKm > 0 ? Math.round(lastKm) : null, last_visit: parseDate(g(f, "last_visit")),
        total_ht, total_tva: parseAmount(g(f, "total_tva")), total_ttc, seller: g(f, "seller"), raw, hash: hashString(rec.fields.join(";")),
      };
      if (total_ht) res.sumHt += total_ht;
      if (total_ttc) res.sumTtc += total_ttc;
      if (seenHeader.has(inv)) res.duplicateInvoiceRows++;
      seenHeader.set(inv, row); // la dernière occurrence du fichier fait foi
    }
  }
  for (const i of byInv.values()) {
    // Multiset de lignes : on trie les lignes sérialisées (les doublons légitimes restent présents).
    const ser = i.lines.map((l) => [l.line_type, l.ref_n, l.designation, l.qty, l.unit, l.discount, l.net, l.vat_code, l.activity].join("|")).sort();
    i.lines_hash = hashString(ser.join("\n"));
    i.net_ht = round2(i.lines.filter((l) => l.rev).reduce((s, l) => s + (l.net ?? 0), 0));
    i.hours = round2(i.lines.filter((l) => l.hours).reduce((s, l) => s + (l.qty ?? 0), 0));
  }
  res.invoices = [...byInv.values()];
  res.headerRows = [...seenHeader.values()];
  res.orCount = ors.size;
  res.sumHt = round2(res.sumHt);
  res.sumTtc = round2(res.sumTtc);
  return res;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Totaux d'un ensemble de lignes (CA hors en-têtes de forfait, heures = MO + MO forfait). */
export function lineTotals(lines: { line_kind: string; counts_revenue: boolean; counts_hours: boolean; net_ht: number | null; qty: number | null }[]) {
  return {
    ht: round2(lines.filter((l) => l.counts_revenue).reduce((s, l) => s + Number(l.net_ht ?? 0), 0)),
    hours: round2(lines.filter((l) => l.counts_hours).reduce((s, l) => s + Number(l.qty ?? 0), 0)),
  };
}

export function formatHours(h: number): string {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
