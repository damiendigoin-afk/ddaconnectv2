/**
 * Saisie d'un prix : pendant la frappe, chiffres + un seul séparateur décimal (virgule OU point, 2 décimales max),
 * sans reformatage ; conversion en nombre seulement au blur / à la validation ; affichage français ensuite.
 */
export const isPriceTyping = (v: string) => /^\d*(?:[.,]\d{0,2})?$/.test(v.replace(/\s/g, ""));

export function parsePriceInput(v: string | null | undefined): number | null {
  const s = (v ?? "").replace(/[\s\u00a0€]/g, "").replace(",", ".");
  if (!s || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export const formatPriceInput = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : n.toFixed(2).replace(".", ","));
