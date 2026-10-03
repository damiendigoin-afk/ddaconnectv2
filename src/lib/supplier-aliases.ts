/**
 * Point unique des alias fournisseurs codés en dur : nom lu sur un document (commande, BL, facture)
 * -> nom canonique de la fiche. Les établissements d'un même groupe restent distincts (Sarlat ≠ Bergerac).
 */
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export const HARD_SUPPLIER_ALIASES: Record<string, string[]> = {
  "FAURIE AUTO SARLAT": [
    "RENAULT SARLAT - GROUPE FAURIE",
    "RENAULT SARLAT GROUPE FAURIE",
    "RENAULT SARLAT",
    "GROUPE FAURIE SARLAT",
    "FAURIE AUTO SARLAT",
  ],
};

/** Nom canonique si le nom lu est un alias connu (égalité normalisée stricte), sinon null. */
export function canonicalSupplierName(name: string | null | undefined): string | null {
  const n = norm(name);
  if (!n) return null;
  for (const [canon, aliases] of Object.entries(HARD_SUPPLIER_ALIASES)) {
    if (aliases.some((a) => norm(a) === n)) return canon;
  }
  return null;
}

/** Fiche active correspondant à un alias codé en dur (null si aucun alias ou fiche absente). */
export function hardAliasSupplier<T extends { id: string; name: string; active?: boolean | null }>(name: string | null | undefined, suppliers: T[]): T | null {
  const canon = canonicalSupplierName(name);
  if (!canon) return null;
  const c = norm(canon);
  return suppliers.find((s) => s.active !== false && norm(s.name) === c) ?? null;
}
