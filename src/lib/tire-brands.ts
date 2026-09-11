/**
 * Liste de marques pneumatiques pour l'autocomplétion de la saisie manuelle.
 * Sert uniquement à éviter les fautes de frappe : la marque reste facultative
 * et la saisie libre est toujours acceptée. Aucune gamme n'est déduite ici —
 * le classement entrée / milieu / haut de gamme reste celui du paramétrage.
 */
export const TIRE_BRANDS: string[] = [
  "Accelera", "Achilles", "Aeolus", "Antares", "Apollo", "Aplus", "Arivo", "Atlas", "Austone", "Avon",
  "Barum", "BFGoodrich", "Bridgestone", "Ceat", "Compasal", "Continental", "Cooper", "Cordiant",
  "Cratos", "Davanti", "Dayton", "Debica", "Delinte", "Dmack", "Doublestar", "Duraturn", "Dunlop",
  "Effiplus", "Evergreen", "Falken", "Fate", "Firemax", "Firestone", "Formula", "Fortuna", "Fulda",
  "General Tire", "Giti", "Goodride", "Goodyear", "GT Radial", "Gislaved", "Hankook", "Headway",
  "Hifly", "Ilink", "Imperial", "Infinity", "Insa Turbo", "Interstate", "Jinyu", "Kama", "Kapsen",
  "Kenda", "Kingstar", "Kleber", "Kormoran", "Kumho", "Lassa", "Landsail", "Laufenn", "Leao",
  "Linglong", "Marangoni", "Marshal", "Matador", "Maxxis", "Mazzini", "Michelin", "Milestone",
  "Minerva", "Mirage", "Momo", "Nankang", "Nexen", "Nokian", "Nordexx", "Ovation", "Paxaro",
  "Pace", "Petlas", "Pirelli", "Platin", "Point S", "Powertrac", "Premiorri", "Riken", "Roadhog",
  "Roadstone", "Roadx", "Rotalla", "Royal Black", "Sailun", "Sava", "Security", "Semperit",
  "Sonar", "Starmaxx", "Sumitomo", "Sunfull", "Sunny", "Superia", "Syron", "Taurus", "Tigar",
  "Tomket", "Torque", "Toyo", "Tracmax", "Triangle", "Tristar", "Uniroyal", "Vredestein",
  "Wanli", "Westlake", "Windforce", "Yokohama", "Zeetex", "Zeta",
];

/** Suggestions de marques pour une saisie partielle (insensible aux accents/casse). */
export function suggestBrands(input: string, limit = 8): string[] {
  const q = input.trim().toLowerCase();
  if (!q) return [];
  const starts = TIRE_BRANDS.filter((b) => b.toLowerCase().startsWith(q));
  const contains = TIRE_BRANDS.filter((b) => !starts.includes(b) && b.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** Marque du référentiel correspondant exactement à la saisie (sinon saisie conservée). */
export function canonicalBrand(input: string | null | undefined): string | null {
  const q = (input ?? "").trim();
  if (!q) return null;
  return TIRE_BRANDS.find((b) => b.toLowerCase() === q.toLowerCase()) ?? q;
}
