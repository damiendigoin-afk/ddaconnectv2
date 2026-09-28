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
  const found = new Set<string>();
  for (const m of t.matchAll(/(?<![A-Z0-9])([A-Z]{2})[\s.-]?(\d{3})[\s.-]?([A-Z]{2})(?![A-Z0-9])/g)) {
    // SIV : pas de I, O, U ; blocs interdits SS / WW en tête.
    const p = `${m[1]}${m[2]}${m[3]}`;
    if (/[IOU]/.test(m[1]! + m[3]!) || m[2] === "000" || m[1] === "SS" || m[1] === "WW") continue;
    found.add(p);
  }
  if (found.size !== 1) return null;
  return formatPlate([...found][0]!);
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
