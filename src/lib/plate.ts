/** Lettres cyrilliques visuellement identiques aux latines (claviers UA/RU). */
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  "А": "A", "В": "B", "Е": "E", "Ѕ": "S", "І": "I", "Ј": "J", "К": "K", "М": "M",
  "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X",
  "а": "A", "в": "B", "е": "E", "ѕ": "S", "і": "I", "ј": "J", "к": "K", "м": "M",
  "н": "H", "о": "O", "р": "P", "с": "C", "т": "T", "у": "Y", "х": "X",
};

/** Remplace les caractères cyrilliques sosies par leur équivalent latin. */
export function latinizePlate(input: string): string {
  return (input || "").replace(/[\u0400-\u04FF]/g, (ch) => CYRILLIC_LOOKALIKES[ch] ?? ch);
}

export function normalizePlate(input: string): string {
  return latinizePlate(input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Formats a normalized plate for display: AB123CD -> AB-123-CD */
export function formatPlate(input: string): string {
  const n = normalizePlate(input);
  const m = /^([A-Z]{2})(\d{3})([A-Z]{2})$/.exec(n);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const old = /^(\d{1,4})([A-Z]{2,3})(\d{2,3})$/.exec(n);
  if (old) return `${old[1]}-${old[2]}-${old[3]}`;
  return n;
}
/** Immatriculation SIV française (AA-123-AA) trouvée dans un texte libre, format affiché « HG-732-GH ». null si absente ou ambiguë. */
export function findFrenchPlate(text: string | null | undefined): string | null {
  const t = latinizePlate(text || "").toUpperCase();
  const count = new Map<string, number>();
  const DIG: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
  for (const m of t.matchAll(/(?<![A-Z0-9])([A-Z]{2})[\s.-]?([0-9OQDILZSBG]{3})[\s.-]?([A-Z]{2})(?![A-Z0-9])/g)) {
    // Bloc chiffres : sosies OCR corrigés (O->0, I->1, S->5…) seulement s'il y a déjà 2 vrais chiffres.
    if ((m[2]!.match(/\d/g) ?? []).length < 2) continue;
    const digits = m[2]!.replace(/[^0-9]/g, (c) => DIG[c] ?? c);
    // SIV : pas de I, O, U ; blocs interdits SS / WW en tête.
    if (/[IOU]/.test(m[1]! + m[3]!) || digits === "000" || m[1] === "SS" || m[1] === "WW") continue;
    const p = `${m[1]}${digits}${m[3]}`;
    count.set(p, (count.get(p) ?? 0) + 1);
  }
  if (count.size === 0) return null;
  // Plusieurs lectures (2 passes OCR) : la plus fréquente l'emporte ; égalité = ambiguë.
  const ranked = [...count].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null;
  return formatPlate(ranked[0]![0]);
}

/** Historique WinMotor d'une plaque : un OR par numéro, le plus récent d'abord (information seule, jamais un rattachement). */
export function winmotorOrHistory(rows: { or_number: string | null; invoice_date: string | null }[]): { or_number: string; date: string }[] {
  const best = new Map<string, string>();
  for (const r of rows) {
    if (!r.or_number || !r.invoice_date) continue;
    if (!best.has(r.or_number) || best.get(r.or_number)! < r.invoice_date) best.set(r.or_number, r.invoice_date);
  }
  return [...best].map(([or_number, date]) => ({ or_number, date })).sort((a, b) => b.date.localeCompare(a.date));
}

/** Immat du champ « Vos repères » après sélection d'une commande : jamais effacée par une commande sans plaque, saisie utilisateur prioritaire. */
export function plateAfterOrderPick(current: string, docPlate: string | null | undefined, orderPlate: string | null | undefined, userTouched: boolean): string {
  const cur = (current || "").trim();
  if (userTouched && cur) return formatPlate(cur);
  if (cur) return formatPlate(cur);
  if (orderPlate && orderPlate.trim()) return formatPlate(orderPlate);
  if (docPlate && docPlate.trim()) return formatPlate(docPlate);
  return "";
}

const SIV_RE = /^([A-HJ-NP-TV-Z]{2})(\d{3})([A-HJ-NP-TV-Z]{2})$/;
const validSiv = (n: string) => { const m = SIV_RE.exec(n); return !!m && m[2] !== "000" && m[1] !== "SS" && m[1] !== "WW"; };

/**
 * Contrôle strict d'une immatriculation lue (OCR local ou IA) : format SIV AA-123-AA ou ancien FNI.
 * Une lecture « presque » SIV (un caractère en trop, sosies O/0, I/1… dans le bloc chiffres) n'est
 * corrigée que si UNE seule correction est possible ; sinon `hint` (autre lecture du même document)
 * peut trancher ; à défaut null (jamais d'invention). Ex. EMA426NG => 3 corrections possibles => null.
 */
export function strictPlate(raw: unknown, hint?: string | null): string | null {
  if (raw == null) return null;
  const n = normalizePlate(String(raw));
  if (!n) return null;
  if (validSiv(n)) return formatPlate(n);
  if (/^\d{1,4}[A-Z]{2,3}\d{2,3}$/.test(n) && n.length >= 6) return formatPlate(n);
  const DIG: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
  const fix = (s: string) => (s.length === 7 ? s.slice(0, 2) + s.slice(2, 5).replace(/[A-Z]/g, (c) => DIG[c] ?? c) + s.slice(5) : s);
  const cands = new Set<string>();
  if (n.length === 7 && validSiv(fix(n))) cands.add(fix(n));
  if (n.length === 8) for (let i = 0; i < 8; i++) { const c = fix(n.slice(0, i) + n.slice(i + 1)); if (validSiv(c)) cands.add(c); }
  if (cands.size === 1) return formatPlate([...cands][0]!);
  const h = hint ? normalizePlate(hint) : "";
  if (h && cands.has(h)) return formatPlate(h);
  return null;
}
