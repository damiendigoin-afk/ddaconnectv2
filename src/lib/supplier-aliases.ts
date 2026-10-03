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
  DISTRICASH: ["DISTRI CASH BRIVE", "DISTRI CASH", "DISTRICASH BRIVE", "DISTRICASH"],
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

/**
 * Menu fournisseur sans doublon : une entrée par fiche (et par nom normalisé), les « plus utilisés »
 * ne sont pas répétés dans « Tous les fournisseurs » (sauf pendant une recherche).
 */
export function supplierMenu<T extends { id: string; name: string; active?: boolean | null }>(
  suppliers: T[], topIds: string[], search: string, value: string,
): { top: T[]; rest: T[] } {
  const seenName = new Set<string>(); const seenId = new Set<string>();
  const all: T[] = [];
  for (const s of suppliers) {
    if (s.active === false && s.id !== value) continue;
    const k = norm(canonicalSupplierName(s.name) ?? s.name);
    if (seenId.has(s.id) || (seenName.has(k) && s.id !== value)) continue;
    seenId.add(s.id); seenName.add(k); all.push(s);
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  const n = norm(search);
  const top = n ? [] : [...new Set(topIds)].map((id) => byId.get(id)).filter((s): s is T => !!s);
  const topSet = new Set(top.map((s) => s.id));
  const rest = all.filter((s) => !topSet.has(s.id) && (!n || norm(s.name).includes(n) || s.id === value));
  return { top, rest };
}
