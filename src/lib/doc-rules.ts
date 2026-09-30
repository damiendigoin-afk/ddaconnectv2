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

export type SupplierHint = { name: string; header_tokens?: string[] | null; aliases?: string[] | null };
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
  for (const raw of text.split("\n")) {
    if (!label.test(raw)) continue;
    // Un nombre collé à « % » est un taux, jamais un montant.
    const line = raw.replace(/\d+(?:[.,]\d+)?\s*%/g, " ");
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

/** Fournisseur explicitement imprimé (« Distributeur / Fournisseur / Vendeur » sur la ligne ou la suivante). */
export function explicitSupplier(text: string): string | null {
  const rows = cleanText(text).split("\n");
  for (let i = 0; i < rows.length; i += 1) {
    const row = (rows[i] ?? "").trim();
    const same = /^(?:distributeur|fournisseur|vendeur)\s*:\s*(.+)$/i.exec(row)?.[1]?.trim()
      ?? /^(?:distributeur|vendeur)\s+([A-Z][A-Z0-9 '&.\-]{3,})$/.exec(row.replace(/^(\S+)/, (w) => w.toLowerCase()))?.[1]?.trim();
    const next = /^(?:distributeur|fournisseur|vendeur)\s*:?[ ]*$/i.test(row) ? rows[i + 1]?.trim() : null;
    const named = same ?? next;
    if (named && named.length >= 4 && named.length <= 100 && /[A-Za-z]{3}/.test(named) && !isGarageName(named)) return named.toUpperCase();
  }
  return null;
}

/**
 * Le fournisseur explicitement imprimé prime toujours sur les profils appris (hints) :
 * deux agences d'un même groupe (ex. Faurie Sarlat / Bergerac) ne sont jamais confondues.
 */
export function detectSupplier(text: string, hints: SupplierHint[] = []): string | null {
  const explicit = explicitSupplier(text);
  if (explicit) return explicit;
  const norm = ` ${normSupplierName(text)} `;
  const byName = hints.filter((h) => [h.name, ...(h.aliases ?? [])].some((a) => {
    const n = normSupplierName(a);
    return n.length >= 4 && norm.includes(` ${n} `);
  }));
  if (byName.length) return byName.sort((a, b) => b.name.length - a.name.length)[0]!.name;
  const toks = new Set(headerTokens(text));
  // Ville de l'en-tête (« 24200 Sarlat… ») absente du nom du profil, dont un mot distinctif manque au texte :
  // autre établissement du groupe (ex. profil Bergerac sur un BL Sarlat) => profil écarté.
  const head = normSupplierName(cleanText(text).split("\n").slice(0, 15).join("\n").replace(/\b(\d{5})\s+/g, " $1 "));
  const cities = [...head.matchAll(/\b\d{5} ([a-z]{3,})/g)].map((m) => m[1]!);
  const GEN = new Set(["groupe", "group", "auto", "autos", "automobile", "automobiles", "garage", "sas", "sarl", "distribution", "pieces", "piece", "france", "renault"]);
  const otherSite = (h: SupplierHint) => {
    const nw = normSupplierName(h.name).split(" ").filter((w) => w.length >= 3 && !GEN.has(w));
    return cities.some((c) => !nw.includes(c)) && nw.some((w) => !norm.includes(` ${w} `));
  };
  const scored = hints
    .filter((h) => !otherSite(h))
    .map((h) => ({ h, score: (h.header_tokens ?? []).filter((t) => toks.has(t)).length }))
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 1 || (scored.length > 1 && scored[0]!.score > scored[1]!.score)) return scored[0]!.h.name;
  return null;
}

/* ---------------------------- Achats (BL / facture) ------------------------ */

type Line = { reference: string; label: string | null; quantity: number | null; unit_price: number | null; amount: number | null; isolated_number?: string | null; net_price?: number | null };

const REF = String.raw`([A-Z0-9][A-Z0-9.\-/]{3,})`;
const NOT_REF = /^(total|sous|tva|port|frais|remise|net|montant|page|date|facture|commande)$/i;

function qtyOf(s: string): number | null {
  const q = money(s.includes(",") || s.includes(".") ? s : `${s},00`);
  return q != null && q > 0 && q <= 999 ? q : null;
}

const BLOCK_META = /^(?:stock|entrep[oô]t|qt[ée]|quantit[ée]|prix|mode de livraison|livraison|en cours|disponib|informations?|command[ée] par|n[°o]\s*client|distributeur|compte de facturation|total)\b/i;

/**
 * Articles présentés en blocs verticaux par les PDF texte : chaque « Réf : » ouvre
 * une pièce et les champs sémantiques sont cherchés jusqu'à la référence suivante.
 * Un « Prix client … HT » explicite prime toujours sur les montants TTC ou de livraison.
 */
export function parseItemBlocks(text: string): Line[] {
  const rows = cleanText(text).split("\n");
  const starts: number[] = [];
  for (let i = 0; i < rows.length; i += 1) if (/^r[ée]f\.?\s*:\s*[A-Z0-9]/i.test(rows[i] ?? "")) starts.push(i);
  const out: Line[] = [];
  for (let n = 0; n < starts.length; n += 1) {
    const start = starts[n] ?? 0;
    const end = starts[n + 1] ?? rows.length;
    const first = rows[start] ?? "";
    const reference = /^r[ée]f\.?\s*:\s*([A-Z0-9][A-Z0-9.\-/]{3,})/i.exec(first)?.[1]?.toUpperCase() ?? null;
    if (!reference || !/\d/.test(reference)) continue;
    const block = rows.slice(start + 1, end);
    const qtyRaw = firstMatch(block.join("\n"), [/(?:qt[ée]|quantit[ée])\s*:\s*(\d{1,3}(?:[.,]\d{1,2})?)/i]);
    const joined = block.join("\n");
    const CLIENT_RE = /prix\s+(?:client|public)\s*:?\s*(\d[\d .]*[.,]\d{2})\s*(?:€|EUR)?\s*H\.?T\.?/i;
    const clientPrice = firstMatch(joined, [CLIENT_RE]);
    const purchasePrice = firstMatch(joined, [/(?:prix\s+net|net\s+H\.?T\.?|P\.?A\.?(?:\s+net)?|prix\s+(?:unitaire|d['’]achat)|P\.?U\.?)\s*(?:H\.?T\.?)?\s*:?\s*(\d[\d .]*[.,]\d{2})\s*(?:€|EUR)?/i]);
    // Montant HT non libellé (colonne « net » à droite) : candidat PA net, validé plus tard par le total HT.
    // Jamais un montant TTC, ni le montant rattaché au mode de livraison.
    let netCandidate: number | null = null;
    for (let k = 0; k < block.length; k += 1) {
      const row = block[k] ?? "";
      if (/livraison/i.test(row) || /livraison/i.test(block[k - 1] ?? "")) continue;
      const rest = row.replace(CLIENT_RE, " ").replace(new RegExp(`${MONEY}\\s*(?:€|EUR)?\\s*T\\.?T\\.?C\\.?`, "gi"), " ");
      const m = new RegExp(`${MONEY}\\s*(?:€|EUR)?\\s*H\\.?T\\.?`, "i").exec(rest);
      if (m?.[1] && !/prix\s+(?:client|public)/i.test(rest)) netCandidate = money(m[1]);
    }
    const label = block.find((row) => {
      const v = row.trim();
      return v.length >= 2 && /[A-Za-zÀ-ÿ]/.test(v) && !BLOCK_META.test(v) && !/^\d+[.,]\d{2}\s*€/.test(v) && !/\d[.,]\d{2}\s*(?:€|EUR)?\s*(?:H\.?T|T\.?T\.?C)/i.test(v);
    })?.trim() ?? null;
    const explicitNet = purchasePrice ? money(purchasePrice) : null;
    out.push({ reference, label, quantity: qtyOf(qtyRaw ?? "1"), unit_price: explicitNet ?? money(clientPrice), amount: null, net_price: explicitNet ? null : netCandidate });
  }
  return out;
}

/**
 * Lignes article, mises en page variées : « Réf Désignation Qté PU [remise] [Montant] »
 * ou « Qté Réf Désignation PU [HT] [% TVA] [TVA] [Total] » (factures web, ex. Pièce Auto Discount).
 * Un nombre seul (5 chiffres, éventuellement entre parenthèses) sous une ligne = repère isolé (dossier atelier possible).
 */
export function parseItemLines(text: string): Line[] {
  const blocks = parseItemBlocks(text);
  if (blocks.length) return blocks;
  const out: Line[] = [];
  const refFirst = new RegExp(
    String.raw`^${REF}\s+(.+?)\s+(\d{1,3}(?:[.,]\d{1,2})?)\s+${MONEY}\s*(?:€|EUR)?(?:\s+[\d.,%\s]*?)?(?:\s+${MONEY})?\s*(?:€|EUR)?$`,
    "i",
  );
  const qtyFirst = new RegExp(String.raw`^(\d{1,3}(?:[.,]\d{1,2})?)\s+${REF}\s+(.+?)\s+${MONEY}((?:\s*(?:€|EUR)?\s+\d[\d .]*[.,]\d{2}\s*%?)*)\s*(?:€|EUR)?$`, "i");
  let last: Line | null = null;
  let pending: Line | null = null;
  let pendingLabel: Line | null = null;
  let pendingNotes = 0;
  for (const rawLine of text.split("\n")) {
    // Intitulés de section collés à la 1re ligne article (« Recherche libre ECD-FR-016 … ») : ignorés.
    const line = rawLine.replace(/^\s*(?:recherche libre|articles?|pi[eè]ces?)\s*[:\-]?\s+(?=[A-Z0-9])/i, "");
    if (pending) {
      const pr = new RegExp(String.raw`^(?:\(?(\d{5,6})\)?\s+)?${MONEY}\s*(?:€|EUR)?(?:\s+${MONEY}\s*(?:€|EUR)?)?$`, "i").exec(line.trim());
      const p = pending;
      // Ligne d'annotation sous la désignation (« immat: … - or: … », repère) : le bloc reste ouvert.
      const isNote = !pr && pendingNotes < 2 && line.trim() && !/^\d{1,3}\s+[A-Z0-9][A-Z0-9.\-/]{3,}\s/i.test(line.trim()) && !/total|tva|frais|port\b/i.test(line);
      if (isNote) { pendingNotes += 1; continue; }
      pending = null;
      pendingNotes = 0;
      if (pr) {
        const unit = money(pr[2]);
        last = { ...p, unit_price: unit, amount: money(pr[3]) ?? (unit != null && p.quantity != null ? Math.round(unit * p.quantity * 100) / 100 : null), isolated_number: pr[1] ?? null };
        out.push(last);
        continue;
      }
    }
    if (pendingLabel) {
      const label = line.trim();
      const isLabel = label.length >= 3 && /[A-Za-zÀ-ÿ]{3}/.test(label) && !/^(?:immat|o\.?r\.?|total|tva|frais|port|sous-total)\b/i.test(label);
      if (isLabel) {
        last = { ...pendingLabel, label };
        out.push(last);
        pendingLabel = null;
        continue;
      }
      pendingLabel = null;
    }
    // Certains PDF natifs extraient la première désignation sur la ligne suivante :
    // « 1 557119W 24,51 24,51 » puis « Support pare-chocs avant droit ».
    const qtyRefPrices = new RegExp(String.raw`^(\d{1,3}(?:[.,]\d{1,2})?)\s+(${REF})\s+(${MONEY})\s*(?:€|EUR)?(?:\s+(${MONEY})\s*(?:€|EUR)?)?$`, "i").exec(line.trim());
    if (qtyRefPrices && /\d/.test(qtyRefPrices[2]!)) {
      const qty = qtyOf(qtyRefPrices[1]!);
      if (qty != null) {
        pendingLabel = {
          reference: qtyRefPrices[2]!.toUpperCase(),
          label: null,
          quantity: qty,
          unit_price: money(qtyRefPrices[3]),
          amount: money(qtyRefPrices[4]) ?? null,
        };
        continue;
      }
    }
    const bare = /^(\d{1,3})\s+([A-Z0-9][A-Z0-9.\-/]{3,})\s+([^\d€]*[A-Za-zÀ-ÿ]{3}[^€]*?)$/i.exec(line.trim());
    if (bare && /\d/.test(bare[2]!) && !new RegExp(MONEY).test(bare[3]!)) {
      const qty = qtyOf(bare[1]!);
      if (qty != null) { pendingNotes = 0; pending = { reference: bare[2]!.toUpperCase(), label: bare[3]!.trim(), quantity: qty, unit_price: null, amount: null }; continue; }
    }
    const iso = /^\(?\s*(\d{5})\s*\)?$/.exec(line.trim());
    if (iso && last && !last.isolated_number) { last.isolated_number = iso[1]!; continue; }
    // Colonnes techniques en tête (position, n° de colis… « 55 1 ECD-FR-016 … ») : ignorées si le reste est une ligne article.
    const lead = /^\s*(?:\d{1,3}\s+){1,2}(?=\S)/.exec(line);
    const stripped = lead ? line.slice(lead[0].length) : null;
    const m0 = refFirst.exec(line);
    const ms = stripped ? refFirst.exec(stripped) : null;
    // Une ligne « Qté Réf … » reste lue par la présentation quantité d'abord (jamais dépouillée de sa quantité).
    const m = m0 ?? (ms && !qtyFirst.test(line) ? ms : null);
    if (m && /\d/.test(m[1]!) && !NOT_REF.test(m[1]!)) {
      const qty = qtyOf(m[3]!);
      if (qty != null) {
        last = { reference: m[1]!.toUpperCase(), label: m[2]!.trim() || null, quantity: qty, unit_price: money(m[4]), amount: money(m[5]) ?? null };
        out.push(last);
        continue;
      }
    }
    const q = qtyFirst.exec(line);
    if (q && /\d/.test(q[2]!) && /[A-Za-zÀ-ÿ]{3}/.test(q[3]!)) {
      const qty = qtyOf(q[1]!);
      if (qty != null) {
        const nums = [money(q[4]), ...[...(q[5] ?? "").matchAll(new RegExp(MONEY, "g"))].map((x) => money(x[1]))].filter((n): n is number => n != null);
        const unit = nums[0] ?? null;
        // Montant HT de ligne = PU × qté quand il figure parmi les colonnes ; sinon dernier montant.
        const ht = nums.find((n, i) => i > 0 && unit != null && Math.abs(n - unit * qty) < 0.02) ?? (nums.length > 1 ? nums.at(-1)! : unit != null ? Math.round(unit * qty * 100) / 100 : null);
        last = { reference: q[2]!.toUpperCase(), label: q[3]!.trim() || null, quantity: qty, unit_price: unit, amount: ht };
        out.push(last);
        continue;
      }
    }
    if (line.trim()) last = iso ? last : null;
  }
  return out;
}

const LEGAL = /\b(S\.?L\.?U?|S\.?A\.?S?U?|S\.?A\.?R\.?L|EURL|SNC|GMBH|S\.?P\.?A|S\.?R\.?L|B\.?V|LTD|LIMITED|INC|SE|AG|KG)\.?$/i;

/** Émetteur lu dans l'en-tête quand aucune fiche connue ne correspond (raison sociale avec forme juridique). */
export function headerSupplierName(text: string): string | null {
  const head = cleanText(text).split("\n").slice(0, 8);
  for (const l of head) {
    const v = l.replace(/\s{2,}/g, " ").trim();
    if (v.length < 4 || v.length > 60 || /\d{3,}|@|facture|commande|devis|livraison/i.test(v)) continue;
    if (LEGAL.test(v) && !isGarageName(v)) return v.toUpperCase();
  }
  return footerSupplierName(text);
}

/**
 * Raison sociale ailleurs dans le document (pied de page « OSKARBI AUTO SL · adresse · CP ville ») :
 * segments séparés par « · • | – », forme juridique en fin de segment, jamais le garage.
 */
export function footerSupplierName(text: string): string | null {
  const lines = cleanText(text).split("\n");
  for (const l of [...lines].reverse()) {
    for (const seg of l.split(/\s*[·•|–—]\s*/)) {
      const v = seg.replace(/\s{2,}/g, " ").trim();
      if (v.length < 4 || v.length > 60 || /\d{3,}|@|facture|commande|devis|livraison|adresse|total|t\.?v\.?a/i.test(v)) continue;
      if (v.split(" ").length < 2 || !LEGAL.test(v) || isGarageName(v)) continue;
      return v.toUpperCase();
    }
  }
  return null;
}

/**
 * Date de commande : libellé explicite (« Date de commande », « Commandé le ») d'abord ; sinon la colonne
 * « Date » d'un tableau d'en-tête (1re date de la ligne suivante) ; sinon 1re date hors « Payée le / échéance / livraison ».
 */
export function orderDate(raw: string): string | null {
  const text = cleanText(raw);
  const lab = /(?:date\s*(?:de\s*(?:la\s*)?)?commande|command[ée]e?\s+le)\s*[:.]?\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/i.exec(text);
  if (lab) return isoDate(lab[1]);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^date\b/i.test(lines[i]!)) continue;
    const first = /^(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})/.exec(lines[i + 1]!);
    if (first) return isoDate(first[1]);
  }
  const masked = text.replace(/(?:pay[ée]e?\s+le|r[ée]gl[ée]e?\s+le|[ée]ch[ée]ance|livr[ée]e?\s+le|livraison(?:\s+pr[ée]vue)?)\s*[:.]?\s*\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}/gi, "");
  return isoDate(masked);
}

/** Coordonnées de l'émetteur (en-tête, avant les adresses client) : TVA, SIRET, téléphone, e-mail, site. */
export function headerSupplierInfo(text: string): Record<string, string> | null {
  const lines = cleanText(text).split("\n");
  const stop = lines.findIndex((l) => /adresse|livr[ée]|factur[ée] [àa]|client|exp[ée]dition/i.test(l));
  const head = lines.slice(0, stop > 0 ? stop : 10).join("\n");
  const out: Record<string, string> = {};
  const vat = /\b(FR\s?[0-9A-Z]{2}\s?\d{9}|(?:ES|DE|IT|BE|PT|NL|LU)\s?[A-Z0-9]{8,12})\b/.exec(head);
  if (vat) out["vat_number"] = vat[1]!.replace(/\s/g, "");
  const siret = /\b(\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?)\b/.exec(head.replace(/t[ée]l[^\n]*/gi, "").replace(/[^\n]*(?:commande|facture|livraison|colisage|r[ée]f[ée]rence|date)[^\n]*/gi, ""));
  if (siret && !out["vat_number"]) out["siret"] = siret[1]!.replace(/\s/g, "");
  const tel = /t[ée]l[a-z.]*\s*:?\s*([+0-9][0-9 .]{8,18}\d)/i.exec(head);
  if (tel && !isGaragePhone(tel[1]!)) out["phone"] = tel[1]!.trim();
  const mail = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(head);
  if (mail && !isGarageEmail(mail[0])) out["email"] = mail[0].toLowerCase();
  const web = /\b(?:www\.)[\w-]+\.[a-z.]{2,}/i.exec(head);
  if (web) out["website"] = web[0].toLowerCase();
  return Object.keys(out).length ? out : null;
}

/**
 * Tous les identifiants étiquetés du document (Transaction, Commande, Cde, BL, Facture, Réf. commande, Votre réf…).
 * Aucun n'est présumé être LE n° de commande : le rapprochement les compare tous à la commande.
 */
export function refCandidates(raw: string): string[] {
  const text = cleanText(raw);
  const re = /(?:transaction|commande(?:\s+(?:web|internet|en ligne|client|fournisseur))?|cde|bon de livraison|\bb\.?l\.?|facture|r[ée]f(?:[ée]rence)?\.?\s*(?:commande|client)?|votre\s+r[ée]f[a-z.]*|n[°o]\s*(?:de\s*)?(?:pi[eè]ce|document))\s*(?:n[°o]\.?|num[ée]ro)?\s*[:#]?\s*\**\s*([A-Z]{0,3}\d[A-Z0-9\-/]{4,})/gi;
  const out = new Set<string>();
  for (const m of text.matchAll(re)) {
    const v = m[1]!.toUpperCase().replace(/[-/]+$/, "");
    if (/\d{4,}/.test(v) && !findFrenchPlate(v)) out.add(v);
  }
  return [...out].slice(0, 12);
}

/**
 * Repères OR multiples d'un champ « Référence / Repère / Mes références / Dossier / OR » :
 * « Référence : 16952 17072 » => ["16952", "17072"]. Une commande fournisseur peut servir plusieurs OR.
 * N'accepte que des nombres de 5-6 chiffres, jamais le n° de commande/document ni une plaque.
 */
export function orNumbersFromText(raw: string, exclude: (string | null | undefined)[] = []): string[] {
  const text = cleanText(raw);
  const ex = new Set(exclude.map((v) => (v ?? "").replace(/\D/g, "")).filter(Boolean));
  // Chaque repère est borné (jamais le préfixe d'une référence longue) ; plusieurs repères exigent un séparateur réel.
  const re = /(?:^|[^a-z])(?:r[ée]f[ée]rences?|r[ée]f\.?|rep[eè]res?(?:\s+commande)?|mes\s+r[ée]f[ée]rences|votre\s+r[ée]f[a-z.]*|dossiers?|\bO\.?R\.?s?\b)\s*(?:client)?\s*(?:n[°o]s?\.?)?\s*[:#.]?\s*(?<![\d])(\d{5,6}(?:(?:\s*(?:[,;/+&]|et|-)\s*|\s+)\d{5,6})*)(?![\d.,])/gi;
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    for (const n of m[1]!.match(/\d{5,6}/g) ?? []) if (!ex.has(n) && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 8);
}

/**
 * PA net vs prix client : les montants HT non libellés (colonne net) deviennent le PA
 * seulement si, pour toutes les lignes, leur somme retombe sur le total HT du document.
 */
export function resolveNetPrices(lines: Line[], totalHt: number | null): Line[] {
  const useNet = totalHt != null && lines.length > 0 && lines.every((l) => l.net_price != null)
    && Math.abs(lines.reduce((s, l) => s + (l.net_price ?? 0) * (l.quantity ?? 1), 0) - totalHt) <= 0.02;
  return lines.map(({ net_price, ...l }) => (useNet ? { ...l, unit_price: net_price ?? l.unit_price } : l));
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
  const order_reference = firstMatch(text, [/commande\s*(?:web|internet|en ligne|client|fournisseur)?\s*(?:n[°o]\.?|num[ée]ro)?\s*[:#]?\s*\**\s*([A-Z0-9][A-Z0-9\-]{4,})/i]);
  const plate = findFrenchPlate(text);
  const orRaw = firstMatch(text, [OR_LABEL, /\bO\.?R\.?(?:\s*n[°o])?\s*[:#.]\s*(\d{4,7})\b/i]);
  const lines = resolveNetPrices(parseItemLines(text), lastMoneyOnLines(text, /total\s*h\.?t|net\s*h\.?t|montant\s*h\.?t/i));
  const visibleBlocks = [...text.matchAll(/^r[ée]f\.?\s*:\s*[A-Z0-9][A-Z0-9.\-/]{3,}/gim)].length;
  const orderRef = order_reference && /\d/.test(order_reference) ? order_reference : null;
  const or_numbers = orNumbersFromText(text, [orderRef, docNumber]);
  const orSingle = plate && orRaw && findFrenchPlate(orRaw) ? null : orRaw;
  const totalHt = lastMoneyOnLines(text, /total\s*h\.?t|net\s*h\.?t|montant\s*h\.?t/i);
  const vat = lastMoneyOnLines(text, /\bt\.?v\.?a\b/i);
  const totalTtc = lastMoneyOnLines(text, /t\.?t\.?c|net\s*[àa]\s*payer|^total\s+(?!h\.?t)\d/i);
  const supplier = detectSupplier(text, ctx.suppliers) ?? headerSupplierName(text);
  const parsedOrderDate = doc_kind === "facture" ? (/date\s*(?:de\s*)?commande|command[ée]e?\s+le/i.test(text) ? orderDate(text) : null) : orderDate(text);
  const qualityScore = (orderRef ? 1 : 0) + (parsedOrderDate ? 1 : 0) + (supplier ? 1 : 0) + (orSingle || or_numbers.length || plate ? 1 : 0) + (lines.length ? 2 : 0);
  return {
    doc_kind,
    or_numbers: orSingle && !or_numbers.includes(orSingle) && /^\d{5,6}$/.test(orSingle) ? [orSingle, ...or_numbers] : or_numbers,
    ref_candidates: refCandidates(text),
    supplier,
    supplier_info: headerSupplierInfo(text),
    document_number: docNumber,
    document_date: isoDate(text),
    order_date: parsedOrderDate,
    delivery_note_number: doc_kind === "bl" ? docNumber : null,
    invoice_number: doc_kind === "facture" ? docNumber : null,
    invoice_date: doc_kind === "facture" ? isoDate(text) : null,
    order_reference: orderRef,
    or_number: orSingle ?? or_numbers[0] ?? null,
    plate,
    plate_printed: !!plate,
    lines,
    line_quality: lines.length > 0 && (!visibleBlocks || lines.length === visibleBlocks) ? "complete" : null,
    quality_score: qualityScore,
    total_ht: totalHt ?? (vat === 0 ? totalTtc : null),
    vat_amount: vat,
    total_ttc: totalTtc,
    shipping_ht: lastMoneyOnLines(text, /frais de port|\bport\b|transport|emballage/i),
    shipping_label: /^\s*((?:frais\s+de\s+)?(?:port|transport|livraison)[^\d€\n]*?)\s*:?\s*\d[\d .]*[.,]\d{2}/im.exec(text)?.[1]?.trim() ?? null,
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
  const out: Fields = {
    merchant: merchant ? merchant.slice(0, 80) : null,
    date: isoDate(text),
    amount_ttc: lastMoneyOnLines(text, /total|t\.?t\.?c|[àa] payer|montant|carte|\bcb\b/i),
    vat_amount: lastMoneyOnLines(text, /\bt\.?v\.?a\b/i),
    vat_rate: vatRate ? money(vatRate.includes(",") || vatRate.includes(".") ? vatRate : `${vatRate},00`) : null,
    category,
    raw_text: text.split("\n").slice(0, 4).join("\n") || null,
  };
  return reconcileExpenseVat(out, text);
}

/**
 * Cohérence TVA d'un justificatif : taux ≠ montant.
 * - « TVA 20,00% = 4,79 » : 20 = taux, 4,79 = montant.
 * - montant égal au taux, ou supérieur/égal au TTC => rejeté.
 * - montant absent/rejeté mais TTC + taux fiables => TTC × taux / (100 + taux), arrondi centime.
 */
export function reconcileExpenseVat<T extends Record<string, unknown>>(f: T, text?: string | null): T {
  const n = (v: unknown) => (typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "string" && v.trim() ? money(v) : null);
  const ttc = n(f["amount_ttc"]);
  let rate = n(f["vat_rate"]);
  let vat = n(f["vat_amount"]);
  const m = text ? /t\.?v\.?a[^\n%]{0,12}?(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*(?:=|:)?\s*(\d+[.,]\d{2})/i.exec(text) : null;
  if (m) {
    rate ??= money(m[1]!);
    const explicit = money(m[2]!);
    if (explicit != null && (vat == null || (rate != null && Math.abs(vat - rate) < 0.005))) vat = explicit;
  }
  if (rate != null && (rate <= 0 || rate > 30)) rate = null;
  if (vat != null && rate != null && Math.abs(vat - rate) < 0.005) vat = null;
  if (vat != null && ttc != null && vat >= ttc) vat = null;
  if (vat == null && ttc != null && rate != null) vat = Math.round(((ttc * rate) / (100 + rate)) * 100) / 100;
  return { ...f, vat_amount: vat, vat_rate: rate };
}

/* --------------------------- Atelier / véhicule ---------------------------- */

export function orOrPlateRules(raw: string): Fields {
  const text = cleanText(raw);
  const plate = findFrenchPlate(text);
  const or = firstMatch(text, [OR_LABEL]);
  return { or_number: or, plate };
}

/** Kilométrage plausible d'un compteur total (le trip/journalier < 100 km n'est pas un total fiable). */
export function plausibleMileage(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[\s.]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 100 && r < 1_500_000 ? r : null;
}

export function odometerRules(raw: string): Fields {
  const text = cleanText(raw);
  const vals = [...text.matchAll(/(\d[\d .]{2,8}\d)\s*km\b/gi)].map((m) => Number(m[1]!.replace(/\D/g, ""))).filter((n) => n >= 10 && n < 2_000_000);
  const best = plausibleMileage(vals.length ? Math.max(...vals) : null);
  return { mileage: best, unit: best ? "km" : null };
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
  purchase: { rules: purchaseRules, required: ["supplier", "lines", ["order_date", "document_date"]] },
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
