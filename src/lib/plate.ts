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