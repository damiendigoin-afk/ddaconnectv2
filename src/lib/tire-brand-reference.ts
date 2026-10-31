/**
 * Référentiel central de positionnement des marques de pneus (entrée / milieu / haut).
 *
 * Il n'existe AUCUN standard mondial officiel de ces trois niveaux : ce référentiel
 * agrège des positionnements publiés et vérifiables, avec leur source. Il prime sur
 * le paramétrage garage et sur les catégories fournisseurs, pour tous les modes de
 * devis (classique, Top prix, site web, tour véhicule). Jamais de gamme déduite du prix.
 *
 * Statuts :
 * - concordant  : au moins deux sources, toutes d'accord ;
 * - majoritaire : sources divergentes, majorité nette (à revoir) ;
 * - source_unique : une seule source indépendante (à vérifier) ;
 * - divergent   : sources en désaccord sans majorité => aucune gamme globale (à vérifier).
 * - conteste    : sources en désaccord, gamme retenue explicitement avec note (à revoir).
 *
 * Une catégorie fournisseur seule (CentralePneus) n'entre jamais au référentiel :
 * elle ne compte que comme voix supplémentaire à côté d'une source indépendante.
 * Mise à jour : ajouter / corriger une ligne avec sa source et la date de relevé.
 */
export type RefTier = "entree" | "milieu" | "haut";
export type RefStatus = "concordant" | "majoritaire" | "source_unique" | "divergent" | "conteste";

export const BRAND_REFERENCE_CHECKED_ON = "2026-10-31";

export const BRAND_REFERENCE_SOURCES = {
  thetyrelab: {
    label: "TheTyreLab — segments premium / upper-middle / lowcost (agrégateur de tests indépendants)",
    url: "https://www.thetyrelab.com/by-segment/all/",
  },
  tyreshopper: {
    label: "Tyre Shopper (distributeur UK) — Premium / Mid-Range / Low Cost Budget",
    url: "https://www.tyre-shopper.co.uk/brands",
  },
  quelpneu: {
    label: "QuelPneu (comparateur FR) — fiche marque, catégorie entrée de gamme",
    url: "https://www.quelpneu.com/",
  },
  tyrecomp: {
    label: "Tyrecomp (comparateur UK) — Entry-level / Mid-range / Premium",
    url: "https://www.tyrecomp.co.uk/",
  },
  neomatic: {
    label: "Neomatic (distributeur FR) — Eco Budget / Qualité / Premium",
    url: "https://www.neomatic.fr/",
  },
  tyrereviews: {
    label: "TyreReviews (tests indépendants UK) — fiche marque « Mid-Range brand »",
    url: "https://www.tyrereviews.com/",
  },
  syndicatdupneu: {
    label: "Syndicat du Pneu / GfK — synthèse mensuelle, « Marques A ou Premium »",
    url: "https://www.syndicatdupneu.org/synthese-mensuelle/",
  },
  fabricant: {
    label: "Communication marketing du fabricant",
    url: "",
  },
  centralepneus: {
    label: "CentralePneus (distributeur FR) — catégorie premium / quality / discount, relevée en 205/55 R16",
    url: "https://www.centralepneus.fr/",
  },
} as const;
export type RefSourceKey = keyof typeof BRAND_REFERENCE_SOURCES;

/** [clé normalisée, nom, gamme, statut, preuves [source, libellé publié, gamme]] */
type Row = [string, string, RefTier | null, RefStatus, [RefSourceKey, string, RefTier][], string?];
const ROWS: Row[] = [
  // Relevé ciblé 2026-10-31 : quelpneu.com/pneus-roadking, tyrecomp.co.uk/roadking-tyres, neomatic.fr/.../roadking.
  ["ROADKING", "Roadking", "entree", "concordant", [["quelpneu", "Entrée de gamme", "entree"], ["tyrecomp", "Entry-level", "entree"], ["neomatic", "Eco Budget", "entree"]]],
  ["ACCELERA", "Accelera", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ACHILLES", "Achilles", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ACHILLESWINTER", "Achilles\u00a0Winter", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ADMIRAL", "Admiral", "entree", "source_unique", [["tyreshopper", "Low Cost Budget", "entree"]]],
  ["AEOLUS", "Aeolus", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ANTARES", "Antares", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["AOTELI", "Aoteli", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["APLUS", "A-plus", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["APOLLO", "Apollo", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["APTANY", "Aptany", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ATLAS", "Atlas", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["AUTOGREEN", "AutoGreen", "entree", "concordant", [["thetyrelab", "lowcost", "entree"], ["tyreshopper", "Low Cost Budget", "entree"]]],
  ["AUTOGRIP", "Autogrip", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["AVON", "Avon", null, "divergent", [["thetyrelab", "lowcost", "entree"], ["tyreshopper", "Mid-Range", "milieu"]]],
  ["BARUM", "Barum", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["BERLIN", "Berlin", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["BFGOODRICH", "BFGoodrich", "milieu", "source_unique", [["thetyrelab", "upper-middle", "milieu"]]],
  ["BLACKLION", "Blacklion", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["BRIDGESTONE", "Bridgestone", "haut", "concordant", [["thetyrelab", "premium", "haut"], ["tyreshopper", "Premium", "haut"]]],
  ["CACHLAND", "Cachland", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["CHENGSHAN", "Chengshan", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["COMPASAL", "Compasal", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["CONSTANCY", "Constancy", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["CONTINENTAL", "Continental", "haut", "concordant", [["thetyrelab", "premium", "haut"], ["tyreshopper", "Premium", "haut"]]],
  ["COOPER", "Cooper", "milieu", "source_unique", [["thetyrelab", "upper-middle", "milieu"]]],
  ["CRATOS", "Cratos", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["CST", "CST", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DAVANTI", "Davanti", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DAYTON", "Dayton", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DEBICA", "Debica", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DELINTE", "Delinte", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DEZENT", "Dezent", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DOUBLE", "Double", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DOUBLECOIN", "Double Coin", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["DUNLOP", "Dunlop", "haut", "concordant", [["centralepneus", "premium", "haut"], ["thetyrelab", "premium", "haut"], ["tyreshopper", "Premium", "haut"]]],
  ["DURATURN", "Duraturn", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["EFFIPLUS", "Effiplus", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["EPTYRES", "EP-Tyres", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ESA", "Esa", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ESATECAR", "Esa+Tecar", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["EVERGREEN", "Evergreen", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["FALKEN", "Falken", "milieu", "source_unique", [["thetyrelab", "upper-middle", "milieu"]]],
  ["FARROAD", "Farroad", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["FEDERAL", "Federal", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["FIREMAX", "Firemax", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["FIRESTONE", "Firestone", "milieu", "concordant", [["centralepneus", "quality", "milieu"], ["thetyrelab", "upper-middle", "milieu"], ["tyreshopper", "Mid-Range", "milieu"]]],
  ["FORMULA", "Formula", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["FORTUNA", "Fortuna", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["FORTUNE", "Fortune", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["FULDA", "Fulda", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GENERAL", "General", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GERUTTI", "Gerutti", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GISLAVED", "Gislaved", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GITI", "Giti", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GOFORM", "Goform", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GOODRIDE", "Goodride", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GOODYEAR", "GoodYear", "haut", "concordant", [["centralepneus", "premium", "haut"], ["thetyrelab", "premium", "haut"], ["tyreshopper", "Premium", "haut"]]],
  ["GRENLANDER", "Grenlander", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GRIPMAX", "Gripmax", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["GTRADIAL", "GT Radial", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["HAIDA", "Haida", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["HANKOOK", "Hankook", "haut", "majoritaire", [["centralepneus", "premium", "haut"], ["thetyrelab", "premium", "haut"], ["tyreshopper", "Mid-Range", "milieu"]]],
  ["HEADWAY", "Headway", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["HEIDENAU", "Heidenau", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["HIFLY", "Hifly", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["HORIZON", "Horizon", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["IMPERIAL", "Imperial", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["INFINITY", "Infinity", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["INTERSTATE", "Interstate", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["JINYU", "Jinyu", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["KENDA", "Kenda", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["KING", "King", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["KINGMEILER", "King-Meiler", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["KINGSTAR", "Kingstar", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["KLEBER", "Kleber", "milieu", "concordant", [["centralepneus", "quality", "milieu"], ["thetyrelab", "upper-middle", "milieu"]]],
  ["KORMORAN", "Kormoran", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["KUMHO", "Kumho", "milieu", "concordant", [["centralepneus", "quality", "milieu"], ["thetyrelab", "upper-middle", "milieu"]]],
  ["LANDSAIL", "Landsail", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["LANVIGATOR", "Lanvigator", "entree", "concordant", [["centralepneus", "discount", "entree"], ["thetyrelab", "lowcost", "entree"]]],
  ["LASSA", "Lassa", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["LAUFENN", "Laufenn", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["LEXANI", "Lexani", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["LINGLONG", "Linglong", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MABOR", "Mabor", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MARANGONI", "Marangoni", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MARSHAL", "Marshal", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MASTERSTEEL", "Mastersteel", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MATADOR", "Matador", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MAXTREK", "Maxtrek", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MAXXIS", "Maxxis", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MAZZINI", "Mazzini", "entree", "concordant", [["centralepneus", "discount", "entree"], ["thetyrelab", "lowcost", "entree"]]],
  ["METEOR", "Meteor", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["METZELER", "Metzeler", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MICHELIN", "Michelin", "haut", "concordant", [["centralepneus", "premium", "haut"], ["thetyrelab", "premium", "haut"], ["tyreshopper", "Premium", "haut"]]],
  ["MILESTONE", "Milestone", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MINERVA", "Minerva", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MITAS", "Mitas", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["MULTIRAC", "Multirac", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["NANKANG", "Nankang", "entree", "concordant", [["thetyrelab", "lowcost", "entree"], ["tyreshopper", "Low Cost Budget", "entree"]]],
  ["NEOLIN", "Neolin", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["NEXEN", "Nexen", null, "divergent", [["centralepneus", "quality", "milieu"], ["thetyrelab", "lowcost", "entree"]]],
  ["NOKIAN", "Nokian", "haut", "conteste", [["syndicatdupneu", "Marques A ou Premium", "haut"], ["centralepneus", "quality", "milieu"], ["thetyrelab", "upper-middle", "milieu"]], "Haut retenu sur décision de la direction (2026-10-31), conformément au Syndicat du Pneu/GfK (Premium) ; CentralePneus (quality) et TheTyreLab (upper-middle) la placent milieu : classement contesté, à revoir."],
  ["NORAUTO", "Norauto", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["NORDEXX", "Nordexx", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["NOVEX", "Novex", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["OVATION", "Ovation", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["PAXARO", "Paxaro", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["PETLAS", "Petlas", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["PIRELLI", "Pirelli", "haut", "concordant", [["thetyrelab", "premium", "haut"], ["tyreshopper", "Premium", "haut"]]],
  ["PLATIN", "Platin", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["PNEUMANT", "Pneumant", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["POWERTRAC", "Powertrac", "entree", "concordant", [["centralepneus", "discount", "entree"], ["thetyrelab", "lowcost", "entree"]]],
  ["PREMADA", "Premada", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["PREMIORRI", "Premiorri", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["PROFIL", "Profil", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["RACEALONE", "Racealone", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["RADAR", "Radar", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["RIKEN", "Riken", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ROADSTONE", "Roadstone", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ROSAVA", "Rosava", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ROTALLA", "Rotalla", "entree", "concordant", [["centralepneus", "discount", "entree"], ["thetyrelab", "lowcost", "entree"]]],
  ["ROVELO", "Rovelo", "entree", "concordant", [["thetyrelab", "lowcost", "entree"], ["tyreshopper", "Low Cost Budget", "entree"]]],
  ["ROYAL", "Royal", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["RUNWAY", "Runway", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SAETTA", "Saetta", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SAILUN", "Sailun", null, "divergent", [["thetyrelab", "lowcost", "entree"], ["tyreshopper", "Mid-Range", "milieu"]]],
  ["SAVA", "Sava", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SEBRING", "Sebring", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SECURITY", "Security", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SEIBERLING", "Seiberling", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SEMPERIT", "Semperit", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SONAR", "Sonar", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SPORTIVA", "Sportiva", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["STARFIRE", "Starfire", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["STARMAXX", "Starmaxx", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SUMITOMO", "Sumitomo", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SUNNY", "Sunny", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SUPERIA", "Superia", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["SYRON", "Syron", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TAURUS", "Taurus", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["THREEA", "Three-A", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TIGAR", "Tigar", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TOLEDO", "Toledo", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TOMASON", "Tomason", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TOMKET", "Tomket", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TORQUE", "Torque", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TOURADOR", "Tourador", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TOYO", "Toyo", "milieu", "source_unique", [["thetyrelab", "upper-middle", "milieu"]]],
  ["TRACMAX", "Tracmax", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TRIANGEL", "Triangel", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TRISTAR", "Tristar", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["TYFOON", "Tyfoon", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["UNIGRIP", "Unigrip", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["UNIROYAL", "Uniroyal", "milieu", "source_unique", [["thetyrelab", "upper-middle", "milieu"]]],
  ["VIKING", "Viking", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["VREDESTEIN", "Vredestein", "milieu", "conteste", [["tyrereviews", "Mid-Range brand", "milieu"], ["quelpneu", "Milieu de gamme", "milieu"], ["thetyrelab", "premium", "haut"], ["syndicatdupneu", "Marques A ou Premium", "haut"], ["fabricant", "positionnement premium revendiqué", "haut"]], "Milieu retenu (TyreReviews, QuelPneu, relevé 2026-10-31) ; Syndicat du Pneu/GfK, TheTyreLab et le fabricant la placent premium : classement contesté, à revoir."],
  ["WANLI", "Wanli", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["WESTLAKE", "Westlake", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["WINDFORCE", "WindForce", "entree", "concordant", [["centralepneus", "discount", "entree"], ["thetyrelab", "lowcost", "entree"]]],
  ["YOKOHAMA", "Yokohama", "milieu", "source_unique", [["thetyrelab", "upper-middle", "milieu"]]],
  ["ZEETEX", "Zeetex", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ZENISES", "Zenises", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ZETA", "Zeta", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
  ["ZTYRE", "Z-Tyre", "entree", "source_unique", [["thetyrelab", "lowcost", "entree"]]],
];

export type BrandReference = {
  key: string;
  brand: string;
  tier: RefTier | null;
  status: RefStatus;
  evidence: { source: RefSourceKey; label: string; tier: RefTier }[];
  checkedOn: string;
  note: string | null;
};

/** Variantes d'orthographe connues => clé canonique (après normalisation). */
const ALIASES: Record<string, string> = {
  DOUBLECOINTYRES: "DOUBLECOIN",
  GTRADIALTYRES: "GTRADIAL",
  BFG: "BFGOODRICH",
  CONTI: "CONTINENTAL",
};

/** Clé de marque : majuscules, sans accents, espaces ni ponctuation, suffixes génériques retirés. */
export function normalizeBrandKey(brand: string | null | undefined): string {
  const k = (brand ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(TYRES|TIRES|PNEUS|PNEUMATIQUES)$/, "");
  return ALIASES[k] ?? k;
}

const INDEX = new Map<string, BrandReference>(
  ROWS.map(([key, brand, tier, status, ev, note]) => [
    key,
    { key, brand, tier, status, evidence: ev.map(([source, label, t]) => ({ source, label, tier: t })), checkedOn: BRAND_REFERENCE_CHECKED_ON, note: note ?? null },
  ]),
);

/** Entrée du référentiel (y compris « divergent », sans gamme). */
export function brandReferenceOf(brand: string | null | undefined): BrandReference | null {
  return INDEX.get(normalizeBrandKey(brand)) ?? null;
}

/** Gamme globale de la marque, ou null si absente / divergente (=> à vérifier). */
export function globalBrandTier(brand: string | null | undefined): RefTier | null {
  return brandReferenceOf(brand)?.tier ?? null;
}

export function brandReferenceEntries(): BrandReference[] {
  return [...INDEX.values()];
}
