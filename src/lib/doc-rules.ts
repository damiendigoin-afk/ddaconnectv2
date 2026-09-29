/**
 * Règles déterministes de lecture de documents (aucune IA) — logique pure, testable.
 * Entrée : texte OCR local / texte natif PDF. Sortie : champs au format des prompts historiques.
 * Règle DDA : OCR/extraction non générative -> règles -> IA seulement en ultime recours.
 */
import { findFrenchPlate, formatPlate } from "./plate";
import { normSupplierName } from "./supplier-identify";
import { isGarageAddress, isGarageEmail, isGarageName, isGaragePhone } from "./garage-identity";

export type Fields = Record<string, unknown>;
export type DocKind =
  | "purchase"
  | "expense"
  | "or_or_plate"
  | "plate"
  | "odometer"
  | "battery"
  | "technical_control"
  | "registration"
  | "any_document"
  | "repair_order"
  | "none";

export type SupplierHint = { name: string; header_tokens?: string[] | null };
export type RuleContext = { suppliers?: SupplierHint[] };

/* ------------------------------ Normalisation ------------------------------ */

export function cleanText(t: string | null | undefined): string {
  return (t ?? "")
    .replace(/\r/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** « 1 234,56 » / « 1234.56 » -> 1234.56 */
export function money(s: string | null | undefined): number | null {
  if (!s) return null;
  const v = s.replace(/[\s\u00a0€]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** 28/09/2026, 28-09-26, 28.09.2026 -> 2026-09-28 */
export function isoDate(s: string | null | undefined): string | null {
  const m = /(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(s ?? "");
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MONEY = String.raw`(\d{1,3}(?:[ .]\d{3})*[.,]\d{2}|\d+[.,]\d{2})`;

function firstMatch(text: string, res: RegExp[]): string | null {
  for (const re of res) {
    const m = re.exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function lastMoneyOnLines(text: string, label: RegExp): number | null {
  let found: number | null = null;
  for (const line of text.split("\n")) {
    if (!label.test(line)) continue;
    const all = [...line.matchAll(new RegExp(MONEY, "g"))];
    const last = all.at(-1)?.[1];
    if (last) found = money(last);
  }
  return found;
}

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
function findVin(t: string): string | null {
  const m = VIN_RE.exec(t.toUpperCase().replace(/[\s]/g, (c) => c));
  return m && /\d/.test(m[1]!) && /[A-Z]/.test(m[1]!) ? m[1]! : null;
}

const OR_LABEL = /(?:\bO\.?R\.?\b|ordre de r[ée]paration|dossier|rep[eè]re(?: commande)?|votre r[ée]f(?:[ée]rence)?|r[ée]f\.? client|mes r[ée]f[ée]rences)\s*(?:n[°o]\.?|num[ée]ro)?\s*[:#.]?\s*\**\s*(\d{4,7})\b/i;

/* ------------------------------ Fournisseurs ------------------------------- */

export function headerTokens(text: string): string[] {
  const head = cleanText(text).split("\n").slice(0, 15).join(" ");
  const words = normSupplierName(head).split(" ").filter((w) => w.length >= 4 && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, 20);
}

export function detectSupplier(text: string, hints: SupplierHint[] = []): string | null {
  const norm = ` ${normSupplierName(text)} `;
  const byName = hints.filter((h) => {
    const n = normSupplierName(h.name);
    return n.length >= 4 && norm.includes(` ${n} `);
  });
  if (byName.length) return byName.sort((a, b) => b.name.length - a.name.length)[0]!.name;
  const toks = new Set(headerTokens(text));
  const scored = hints
    .map((h) => ({ h, score: (h.header_tokens ?? []).filter((t) => toks.has(t)).length }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1 || (scored.length > 1 && scored[0]!.score > scored[1]!.score)) return scored[0]!.h.name;
  return null;
}

/* ---------------------------- Achats (BL / facture) ------------------------ */

type Line = { reference: string; label: string | null; quantity: number | null; unit_price: number | null; amount: number | null };

export function parseItemLines(text: string): Line[] {
  const out: Line[] = [];
  const re = new RegExp(
    String.raw`^([A-Z0-9][A-Z0-9.\-/]{3,})\s+(.+?)\s+(\d{1,3}(?:[.,]\d{1,2})?)\s+${MONEY}(?:\s+[\d.,%\s]*?)?(?:\s+${MONEY})?\s*€?$`,
    "i",
  );
  for (const line of text.split("\n")) {
    const m = re.exec(line);
    if (!m || !/\d/.test(m[1]!)) continue;
    const qty = money(m[3]!.includes(",") || m[3]!.includes(".") ? m[3]! : `${m[3]},00`);
    if (qty == null || qty <= 0 || qty > 999) continue;
    out.push({
      reference: m[1]!.toUpperCase(),
      label: m[2]!.trim() || null,
      quantity: qty,
      unit_price: money(m[4]),
      amount: money(m[5]) ?? null,
    });
  }
  return out;
}

export function purchaseRules(raw: string, ctx: RuleContext = {}): Fields {
  const text = cleanText(raw);
  const low = text.toLowerCase();
  const doc_kind = /facture/.test(low) && !/bon de livraison/.test(low)
    ? "facture"
    : /bon de livraison|\bb\.?l\.?\b/.test(low)
      ? "bl"
      : /commande|confirmation/.test(low)
        ? "commande"
        : null;
  const docNumber = firstMatch(text, [
    /(?:facture|bon de livraison|\bB\.?L\.?|n°\s*(?:de\s*)?(?:document|pi[eè]ce))\s*(?:n[°o]\.?|num[ée]ro)?\s*[:#]?\s*([A-Z]{0,3}\d[A-Z0-9\-/]{3,})/i,
  ]);
  const order_reference = firstMatch(text, [/commande\s*(?:n[°o]\.?|num[ée]ro)?\s*[:#]?\s*\**\s*([A-Z0-9][A-Z0-9\-]{4,})/i]);
  const plate = findFrenchPlate(text);
  const orRaw = firstMatch(text, [OR_LABEL]);
  const lines = parseItemLines(text);
  return {
    doc_kind,
    supplier: detectSupplier(text, ctx.suppliers),
    document_number: docNumber,
    document_date: isoDate(text),
    delivery_note_number: doc_kind === "bl" ? docNumber : null,
    invoice_number: doc_kind === "facture" ? docNumber : null,
    invoice_date: doc_kind === "facture" ? isoDate(text) : null,
    order_reference: order_reference && /\d/.test(order_reference) ? order_reference : null,
    or_number: plate && orRaw && findFrenchPlate(orRaw) ? null : orRaw,
    plate,
    plate_printed: !!plate,
    lines,
    total_ht: lastMoneyOnLines(text, /total\s*h\.?t|net\s*h\.?t|montant\s*h\.?t/i),
    vat_amount: lastMoneyOnLines(text, /\bt\.?v\.?a\b/i),
    total_ttc: lastMoneyOnLines(text, /t\.?t\.?c|net\s*[àa]\s*payer/i),
    currency: "EUR",
  };
}

/* ------------------------------- Note de frais ----------------------------- */

export function expenseRules(raw: string): Fields {
  const text = cleanText(raw);
  const low = text.toLowerCase();
  const merchant = text.split("\n").find((l) => /[a-zA-Z]{3,}/.test(l) && !/ticket|re[çc]u|facture|bienvenue/i.test(l)) ?? null;
  const category = /gazole|diesel|sans plomb|sp ?9[58]|e10|carburant|litres?\b/.test(low)
    ? "carburant"
    : /p[ée]age|autoroute|vinci|sanef|aprr|asf\b/.test(low)
      ? "peage"
      : /parking|stationnement/.test(low)
        ? "parking"
        : /h[ôo]tel|nuit[ée]e|chambre/.test(low)
          ? "hotel"
          : /restaurant|brasserie|menu|couverts?|boisson/.test(low)
            ? "restaurant"
            : null;
  const vatRate = /(?:tva|t\.v\.a)\s*[:]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i.exec(text)?.[1];
  return {
    merchant: merchant ? merchant.slice(0, 80) : null,
    date: isoDate(text),
    amount_ttc: lastMoneyOnLines(text, /total|t\.?t\.?c|[àa] payer|montant|carte|\bcb\b/i),
    vat_amount: lastMoneyOnLines(text, /\bt\.?v\.?a\b/i),
    vat_rate: vatRate ? money(vatRate.includes(",") || vatRate.includes(".") ? vatRate : `${vatRate},00`) : null,
    category,
    raw_text: text.split("\n").slice(0, 4).join("\n") || null,
  };
}

/* --------------------------- Atelier / véhicule ---------------------------- */

export function orOrPlateRules(raw: string): Fields {
  const text = cleanText(raw);
  const plate = findFrenchPlate(text);
  const or = firstMatch(text, [OR_LABEL]);
  return { or_number: or, plate };
}

export function odometerRules(raw: string): Fields {
  const text = cleanText(raw);
  const vals = [...text.matchAll(/(\d[\d .]{2,8}\d)\s*km\b/gi)].map((m) => Number(m[1]!.replace(/\D/g, ""))).filter((n) => n >= 10 && n < 2_000_000);
  return { mileage: vals.length ? Math.max(...vals) : null, unit: vals.length ? "km" : null };
}

export function batteryRules(raw: string): Fields {
  const t = cleanText(raw).toUpperCase();
  const verdict = /REMPLACER|REPLACE|BAD|MAUVAIS/.test(t)
    ? "a_remplacer"
    : /RECHARG|SURVEILLER|WARN/.test(t)
      ? "a_surveiller"
      : /\bGOOD\b|\bBONNE?\b/.test(t)
        ? "bonne"
        : null;
  const volt = /(\d{1,2}[.,]\d{1,2})\s*V\b/.exec(t)?.[1];
  const ccas = [...t.matchAll(/(\d{2,4})\s*(?:A|CCA|EN)\b/g)].map((m) => Number(m[1]));
  const soh = /SOH\s*[:=]?\s*(\d{1,3})\s*%/.exec(t)?.[1];
  const soc = /SOC\s*[:=]?\s*(\d{1,3})\s*%/.exec(t)?.[1];
  return {
    verdict,
    voltage: volt ? money(volt.includes(",") || volt.includes(".") ? volt : `${volt},00`) : null,
    cca_measured: ccas[0] ?? null,
    cca_rated: ccas[1] ?? null,
    soh_pct: soh ? Number(soh) : null,
    soc_pct: soc ? Number(soc) : null,
  };
}

export function technicalControlRules(raw: string): Fields {
  const text = cleanText(raw);
  const due = firstMatch(text, [/(?:avant le|prochain(?:e)? (?:contr[ôo]le|visite)|validit[ée]|[ée]ch[ée]ance)[^\d]{0,30}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i]);
  const pol = firstMatch(text, [/pollution[^\d]{0,40}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i]);
  return { ct_due_date: isoDate(due), pollution_due_date: isoDate(pol), vehicle_kind: /\bVU\b|utilitaire|CTTE/i.test(text) ? "vu" : "vp" };
}

export function registrationRules(raw: string): Fields {
  const text = cleanText(raw);
  const a = firstMatch(text, [/\bA\.?\s*[:]?\s*([A-Z]{2}[\s-]?\d{3}[\s-]?[A-Z]{2})/]);
  const b = firstMatch(text, [/\bB\.?\s*[:]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/]);
  return {
    plate: a ? formatPlate(a) : findFrenchPlate(text),
    vin: findVin(text),
    brand: firstMatch(text, [/\bD\.1\.?\s*[:]?\s*([A-Z][A-Z \-]{1,20})/]),
    model: firstMatch(text, [/\bD\.3\.?\s*[:]?\s*([A-Z0-9][A-Z0-9 \-]{1,25})/]),
    first_registration: isoDate(b),
    energy: firstMatch(text, [/\bP\.3\.?\s*[:]?\s*([A-Z]{2})\b/]),
  };
}

export function anyDocumentRules(raw: string): Fields {
  const text = cleanText(raw);
  const low = text.toLowerCase();
  const doc_kind = /certificat d'immatriculation|carte grise/.test(low)
    ? "carte_grise"
    : /ordre de r[ée]paration/.test(low)
      ? "or"
      : /rapport d'expertise/.test(low)
        ? "rapport_expertise"
        : /constat amiable/.test(low)
          ? "constat"
          : /facture/.test(low)
            ? "facture"
            : /devis/.test(low)
              ? "devis"
              : /bon de livraison/.test(low)
                ? "bl"
                : null;
  const km = odometerRules(text)["mileage"];
  return {
    doc_kind,
    plate: findFrenchPlate(text),
    vin: findVin(text),
    or_number: firstMatch(text, [OR_LABEL]),
    claim_number: firstMatch(text, [/sinistre\s*(?:n[°o]\.?)?\s*[:#]?\s*([A-Z0-9\-]{5,})/i]),
    mission_number: firstMatch(text, [/mission\s*(?:n[°o]\.?)?\s*[:#]?\s*([A-Z0-9\-]{5,})/i]),
    customer_email: /[\w.+-]+@[\w-]+\.[\w.]+/.exec(text)?.[0] ?? null,
    customer_phone: /(?:\+33|0)[1-9](?:[ .]?\d{2}){4}/.exec(text)?.[0] ?? null,
    mileage: km,
    document_date: isoDate(text),
  };
}

const CAR_BRANDS = ["ALFA ROMEO", "AUDI", "BMW", "CITROEN", "DACIA", "DS", "FIAT", "FORD", "HONDA", "HYUNDAI", "JEEP", "KIA", "LAND ROVER", "MAZDA", "MERCEDES", "MINI", "MITSUBISHI", "NISSAN", "OPEL", "PEUGEOT", "RENAULT", "SEAT", "SKODA", "SMART", "SUZUKI", "TESLA", "TOYOTA", "VOLKSWAGEN", "VW", "VOLVO", "IVECO", "LEXUS", "PORSCHE", "CUPRA", "MG"];

/** Téléphone français normalisé « 06 12 34 56 78 » ; mobile = 06/07. */
export function findFrenchPhones(text: string): { phone: string | null; mobile: string | null } {
  let phone: string | null = null;
  let mobile: string | null = null;
  for (const m of text.matchAll(/(?<!\d)(?:\+33\s?|0033\s?|0)([1-9])(?:[\s.-]?\d{2}){4}(?!\d)/g)) {
    const digits = m[0].replace(/\D/g, "").replace(/^(0033|33)/, "0");
    const d = digits.length === 9 ? `0${digits}` : digits;
    if (d.length !== 10) continue;
    if (isGaragePhone(d)) continue; // téléphone de l'en-tête du garage
    const f = d.replace(/(\d{2})(?=\d)/g, "$1 ");
    if (/^0[67]/.test(d)) mobile ??= f;
    else phone ??= f;
  }
  return { phone, mobile };
}

/** Lignes suivant un libellé (« Travaux demandés », « Demande client »…) jusqu'au prochain libellé. */
function blockAfter(lines: string[], label: RegExp, max = 8): string | null {
  const i = lines.findIndex((l) => label.test(l));
  if (i < 0) return null;
  const inline = lines[i]!.replace(label, "").replace(/^\s*[:\-]\s*/, "").trim();
  const out: string[] = inline ? [inline] : [];
  for (const l of lines.slice(i + 1, i + 1 + max)) {
    if (/^(total|montant|signature|date|client|v[ée]hicule|kilom|immat|conseiller|r[ée]ception)/i.test(l) || /:\s*$/.test(l)) break;
    out.push(l);
  }
  return out.length ? out.join("\n") : null;
}

export function repairOrderRules(raw: string): Fields {
  const text = cleanText(raw);
  const lines = text.split("\n");
  const upper = text.toUpperCase();
  // E-mail client = premier e-mail qui n'est pas celui du garage (en-tête de l'OR).
  const email = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase()).find((e) => !isGarageEmail(e)) ?? null;
  const { phone, mobile } = findFrenchPhones(text);
  // Adresse : ligne « code postal + ville » précédée de la ligne de rue.
  let address: string | null = null, postal_code: string | null = null, city: string | null = null;
  const cpIdx = lines.findIndex((l, i) => /^\d{5}\s+[A-ZÀ-Ü][A-ZÀ-Ü' -]{2,}$/i.test(l) && !isGarageAddress(lines[i - 1]) && !isGarageName(lines[i - 1]));
  if (cpIdx >= 0) {
    const m = /^(\d{5})\s+(.+)$/.exec(lines[cpIdx]!)!;
    postal_code = m[1]!;
    city = m[2]!.trim().toUpperCase();
    const prev = lines[cpIdx - 1];
    if (prev && /\d/.test(prev) && /\b(rue|av|avenue|bd|boulevard|chemin|route|place|all[ée]e|impasse|lieu[- ]dit|lotissement|quai|cours)\b/i.test(prev)) address = prev;
  }
  // Client : « M. / Mme / Monsieur / Madame / Société / Client : NOM Prénom ».
  let last_name: string | null = null, first_name: string | null = null;
  const cm0 = /(?:^|\n)\s*(?:client\s*:?\s*)?(M\.|MR|MME|MLLE|MONSIEUR|MADAME|SOCI[ÉE]T[ÉE]|SARL|SAS|EURL|SA)\s+([A-ZÀ-Ü][A-ZÀ-Ü' -]{1,40})(?:\s+([A-ZÀ-Üa-zà-ü][a-zà-ü'-]{1,30}))?\s*$/im.exec(text)
    ?? /client\s*:\s*([A-ZÀ-Ü][A-ZÀ-Ü' -]{1,40})(?:\s+([A-ZÀ-Üa-zà-ü][a-zà-ü'-]{1,30}))?\s*$/im.exec(text);
  // Raison sociale du garage (en-tête) : jamais retenue comme client.
  const cm = cm0 && !isGarageName(cm0.slice(1).filter(Boolean).join(" ")) ? cm0 : (() => {
    const re = /(?:^|\n)\s*(?:client\s*:?\s*)?(M\.|MR|MME|MLLE|MONSIEUR|MADAME|SOCI[ÉE]T[ÉE]|SARL|SAS|EURL|SA)\s+([A-ZÀ-Ü][A-ZÀ-Ü' -]{1,40})(?:\s+([A-ZÀ-Üa-zà-ü][a-zà-ü'-]{1,30}))?\s*$/gim;
    for (const m of text.matchAll(re)) if (!isGarageName(m.slice(1).filter(Boolean).join(" "))) return m as unknown as RegExpExecArray;
    return /client\s*:\s*([A-ZÀ-Ü][A-ZÀ-Ü' -]{1,40})(?:\s+([A-ZÀ-Üa-zà-ü][a-zà-ü'-]{1,30}))?\s*$/im.exec(text);
  })();
  if (cm && cm.length === 4 && !/SOCI|SARL|SAS|EURL|^SA$/i.test(cm[1]!) && !cm[3]) {
    // « DUPONT Jean » capturé d'un bloc (drapeau i) : nom = mots en majuscules, prénom = le reste.
    const toks = cm[2]!.trim().split(/\s+/);
    const up = toks.filter((t) => t === t.toUpperCase());
    const rest = toks.filter((t) => t !== t.toUpperCase());
    if (up.length && rest.length) { cm[2] = up.join(" "); cm[3] = rest.join(" "); }
  }
  if (cm) {
    const company = cm.length === 4 && /SOCI|SARL|SAS|EURL|^SA$/i.test(cm[1]!);
    if (cm.length === 4) {
      last_name = company ? `${cm[1]!.toUpperCase()} ${cm[2]!.trim()}`.trim() : cm[2]!.trim();
      first_name = company ? null : (cm[3]?.trim() ?? null);
    } else {
      last_name = cm[1]!.trim();
      first_name = cm[2]?.trim() ?? null;
    }
  }
  const brand = CAR_BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(upper)) ?? null;
  let model: string | null = null;
  if (brand) {
    const mm = new RegExp(`\\b${brand}\\b\\s+([A-Z0-9][A-Z0-9 .\\-]{1,24})`, "i").exec(text);
    model = mm?.[1]?.split(/\s{2,}|\n/)[0]?.trim() ?? null;
  }
  const account_number = firstMatch(text, [/(?:n[°o]\s*client|code client|compte client|client n[°o])\s*[:.]?\s*((?=[A-Z0-9]*\d)[A-Z0-9]{3,12})\b/i]);
  const orDate = firstMatch(text, [/(?:date(?: de l'?OR| OR| entr[ée]e)?)\s*[:.]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i]);
  return {
    client: { account_number, last_name, first_name, address, postal_code, city, phone, mobile, email },
    vehicle: { plate: findFrenchPlate(text), vin: findVin(text), brand: brand === "VW" ? "VOLKSWAGEN" : brand, model, mileage: odometerRules(text)["mileage"] },
    order: {
      or_number: firstMatch(text, [OR_LABEL]),
      or_date: isoDate(orDate ?? text),
      requested_work: blockAfter(lines, /travaux (?:demand[ée]s|[àa] effectuer)|demande(?:s)? (?:du )?client|intervention(?:s)? demand[ée]e?s?/i),
      client_remarks: blockAfter(lines, /remarques?|observations?/i, 4),
    },
  };
}

/** 2e passe OCR gratuite utile sur une photo d'OR papier : n° d'OR ou immatriculation non lus. */
export function orScanNeedsRetry(text: string): boolean {
  const t = cleanText(text);
  return !findFrenchPlate(t) || !OR_LABEL.test(t);
}

/* ------------------------------- Registre ---------------------------------- */

const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const at = (o: Fields, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Fields)[k] : undefined), o);

export type DocSpec = {
  rules: (text: string, ctx: RuleContext) => Fields;
  /** Champs indispensables ; un tableau imbriqué = « au moins un de ». */
  required: (string | string[])[];
};

export const DOC_SPECS: Record<DocKind, DocSpec> = {
  purchase: { rules: purchaseRules, required: ["supplier", "lines"] },
  expense: { rules: expenseRules, required: ["merchant", "date", "amount_ttc"] },
  or_or_plate: { rules: orOrPlateRules, required: [["or_number", "plate"]] },
  plate: { rules: orOrPlateRules, required: ["plate"] },
  odometer: { rules: odometerRules, required: ["mileage"] },
  battery: { rules: batteryRules, required: ["verdict", "voltage"] },
  technical_control: { rules: technicalControlRules, required: ["ct_due_date"] },
  registration: { rules: registrationRules, required: ["plate", "vin"] },
  any_document: { rules: anyDocumentRules, required: [["plate", "vin", "or_number"]] },
  repair_order: { rules: repairOrderRules, required: ["order.or_number", "vehicle.plate", "order.requested_work"] },
  none: { rules: () => ({}), required: ["__ai_only__"] },
};

export function missingFields(spec: DocSpec, f: Fields): string[] {
  const out: string[] = [];
  for (const r of spec.required) {
    if (Array.isArray(r)) {
      if (r.every((k) => empty(at(f, k)))) out.push(r.join("|"));
    } else if (empty(at(f, r))) out.push(r);
  }
  return out;
}

/** Complète seulement les champs absents (une valeur déjà lue n'est jamais écrasée). */
export function fillMissing(base: Fields, extra: Fields | null | undefined): Fields {
  if (!extra) return base;
  const out: Fields = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const cur = out[k];
    if (cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = fillMissing(cur as Fields, v as Fields);
    } else if (empty(cur) || cur === false) out[k] = v;
  }
  return out;
}
