/**
 * Catalogue déterministe des indicateurs du suivi mensuel (modèle : derniers onglets 2026).
 * Aucun appel IA : la reconnaissance se fait par libellé normalisé + alias explicites.
 */

export type SectionKey = "ca" | "marge" | "activite" | "achats" | "charges_ext" | "fournitures" | "fixes" | "vo";

export type Indicator = {
  key: string;
  label: string;
  section: SectionKey;
  /** true = pourcentage/ratio, sinon montant ou quantité. */
  unit?: "eur" | "h" | "nb" | "pct";
  aliases?: string[];
};

export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "ca", label: "Après-vente / CA" },
  { key: "marge", label: "Marge APV" },
  { key: "activite", label: "Productivité / Activité" },
  { key: "achats", label: "Achats / Consommations" },
  { key: "charges_ext", label: "Charges externes" },
  { key: "fournitures", label: "Achats non stockés / Fournitures" },
  { key: "fixes", label: "Charges fixes / Sociales" },
  { key: "vo", label: "Véhicules d'occasion" },
];

export const INDICATORS: Indicator[] = [
  // A — Après-vente / CA
  { key: "mo_mecanique", label: "MO Mécanique", section: "ca", unit: "eur", aliases: ["MO MECA"] },
  { key: "mo_tolerie_peinture", label: "MO Tôlerie et peinture", section: "ca", unit: "eur", aliases: ["MO TOLERIE", "MO TOLERIE PEINTURE"] },
  { key: "mo_peinture", label: "MO Peinture", section: "ca", unit: "eur" },
  { key: "mo_sous_traitance", label: "MO Sous-traitance", section: "ca", unit: "eur", aliases: ["MO ST"] },
  { key: "pret_location", label: "Prêt/Location véhicule", section: "ca", unit: "eur", aliases: ["PRET LOCATION VEHICULE", "PRET VEHICULE", "LOCATION VEHICULE"] },
  { key: "depannage_gardiennage", label: "Dépannage/Gardiennage", section: "ca", unit: "eur", aliases: ["DEPANNAGE GARDIENNAGE"] },
  { key: "vente_recyclage", label: "Vente de recyclage", section: "ca", unit: "eur", aliases: ["RECYCLAGE"] },
  { key: "lavage_ventes", label: "Lavage ventes + recettes", section: "ca", unit: "eur", aliases: ["LAVAGE VENTES RECETTES", "LAVAGE"] },
  { key: "ca_mo", label: "C.A. M.O.", section: "ca", unit: "eur", aliases: ["CA MO", "TOTAL MO CA"] },
  { key: "pr_constructeur", label: "PR Constructeur", section: "ca", unit: "eur" },
  { key: "pr_autres_marques", label: "PR Autres marques", section: "ca", unit: "eur", aliases: ["PR AUTRES"] },
  { key: "pr_occasions", label: "PR Occasions", section: "ca", unit: "eur", aliases: ["PR OCCASION"] },
  { key: "pneumatiques", label: "Pneumatiques", section: "ca", unit: "eur", aliases: ["PNEUS"] },
  { key: "lubrifiants", label: "Lubrifiants", section: "ca", unit: "eur", aliases: ["HUILES"] },
  { key: "accessoires", label: "Accessoires", section: "ca", unit: "eur" },
  { key: "carburant", label: "Carburant", section: "ca", unit: "eur" },
  { key: "ca_pr", label: "C.A. P.R.", section: "ca", unit: "eur", aliases: ["CA PR"] },
  { key: "ca_total", label: "Total C.A.", section: "ca", unit: "eur", aliases: ["TOTAL CA", "CA TOTAL", "TOTAL C A"] },
  { key: "rep_atelier", label: "Répartition Atelier", section: "ca", unit: "eur", aliases: ["ATELIER"] },
  { key: "rep_cession", label: "Répartition Cession", section: "ca", unit: "eur", aliases: ["CESSION", "CESSIONS"] },
  { key: "rep_garantie", label: "Répartition Garantie", section: "ca", unit: "eur", aliases: ["GARANTIE", "GARANTIES"] },

  // B — Marge APV
  { key: "marge_mo", label: "Marge MO", section: "marge", unit: "eur", aliases: ["MO"] },
  { key: "marge_st", label: "Marge ST ~25%", section: "marge", unit: "eur", aliases: ["ST 25", "ST25", "MARGE ST"] },
  { key: "marge_autres", label: "Marge Autres", section: "marge", unit: "eur", aliases: ["AUTRES"] },
  { key: "marge_total_mo", label: "Total MO", section: "marge", unit: "eur" },
  { key: "marge_pr", label: "Marge PR ~25%", section: "marge", unit: "eur", aliases: ["PR 25", "PR25", "MARGE PR"] },
  { key: "marge_pneus", label: "Marge Pneus 5%", section: "marge", unit: "eur", aliases: ["PNEUS 5", "PNEUS5"] },
  { key: "marge_huiles", label: "Marge Huiles 50%", section: "marge", unit: "eur", aliases: ["HUILES 50", "HUILES50"] },
  { key: "marge_total_pr", label: "Total PR", section: "marge", unit: "eur" },
  { key: "gain_apv", label: "Total Gain APV", section: "marge", unit: "eur", aliases: ["GAIN APV", "TOTAL GAIN APV"] },
  { key: "marge_total", label: "TOTAL marge", section: "marge", unit: "eur", aliases: ["TOTAL"] },
  { key: "resultat", label: "RESULTAT", section: "marge", unit: "eur", aliases: ["RESULTAT NET"] },
  { key: "taux_marge_apv", label: "Taux marge APV", section: "marge", unit: "pct", aliases: ["TAUX MARGE", "RATIO MARGE"] },

  // C — Productivité / Activité
  { key: "nb_productifs", label: "NB PRODUCTIFS", section: "activite", unit: "nb", aliases: ["NOMBRE PRODUCTIFS", "PRODUCTIFS"] },
  { key: "heures_achetees", label: "Heures achetées", section: "activite", unit: "h", aliases: ["H ACHETEES", "HEURES ACHETEES"] },
  { key: "heures_passees", label: "Heures passées", section: "activite", unit: "h", aliases: ["H PASSEES"] },
  { key: "heures_facturees", label: "Heures facturées", section: "activite", unit: "h", aliases: ["H FACTUREES"] },
  { key: "realisation", label: "Réalisation", section: "activite", unit: "pct", aliases: ["PRODUCTIVITE"] },
  { key: "objectif_heures", label: "Objectif heures", section: "activite", unit: "h", aliases: ["OBJECTIF H", "OBJECTIF HEURES"] },
  { key: "entrees_payantes", label: "Entrées payantes", section: "activite", unit: "nb" },
  { key: "entrees_toutes", label: "Entrées toutes", section: "activite", unit: "nb", aliases: ["ENTREES TOTALES", "TOTAL ENTREES"] },
  { key: "entrees_n1", label: "Entrées N-1", section: "activite", unit: "nb", aliases: ["ENTREES N 1", "ENTREES ANNEE PRECEDENTE"] },
  { key: "vn", label: "VN", section: "activite", unit: "nb" },
  { key: "vo", label: "VO", section: "activite", unit: "nb" },
  { key: "en_cours", label: "En cours", section: "activite", unit: "nb", aliases: ["ENCOURS"] },
  { key: "valorisation_en_cours", label: "Valorisation des en-cours", section: "activite", unit: "eur", aliases: ["VALORISATION ENCOURS", "VALORISATION DES ENCOURS"] },

  // D — Achats / Consommations
  { key: "achats_pr_constructeur", label: "Achats PR Constructeur", section: "achats", unit: "eur" },
  { key: "achats_pr_autres", label: "Achats PR autres marques", section: "achats", unit: "eur", aliases: ["ACHATS PR AUTRES"] },
  { key: "achats_pr_occasion", label: "Achats PR Occasion", section: "achats", unit: "eur" },
  { key: "rrr_achats", label: "RRR sur achats", section: "achats", unit: "eur", aliases: ["RRR"] },
  { key: "achats_pneumatiques", label: "Achats Pneumatiques", section: "achats", unit: "eur" },
  { key: "achats_lubrifiants", label: "Achats Lubrifiants", section: "achats", unit: "eur" },
  { key: "achats_carburant", label: "Achats Carburant", section: "achats", unit: "eur" },
  { key: "igp_conso_carrosserie", label: "IGP et conso carrosserie", section: "achats", unit: "eur", aliases: ["IGP CONSO CARROSSERIE", "IGP"] },
  { key: "conso_generaux", label: "Conso généraux", section: "achats", unit: "eur", aliases: ["CONSOS GENERAUX"] },
  { key: "achats_st", label: "ST", section: "achats", unit: "eur", aliases: ["SOUS TRAITANCE"] },
  { key: "total_achats_pr", label: "Total Achats PR", section: "achats", unit: "eur" },
  { key: "total_achats_conso_st", label: "Total Achats & Conso & ST", section: "achats", unit: "eur", aliases: ["TOTAL ACHATS CONSO ST"] },
  { key: "marge_pr_valeur", label: "Marge PR", section: "achats", unit: "eur" },
  { key: "taux_marge_pr", label: "Taux de marge PR", section: "achats", unit: "pct", aliases: ["TAUX MARGE PR"] },

  // E — Charges externes
  { key: "ch_achat_st", label: "Achat ST", section: "charges_ext", unit: "eur" },
  { key: "ch_ct_tiers_vo", label: "CT tiers + VO", section: "charges_ext", unit: "eur", aliases: ["CT TIERS VO", "CT TIERS"] },
  { key: "ch_st_dechets", label: "ST Déchets", section: "charges_ext", unit: "eur", aliases: ["DECHETS"] },
  { key: "ch_loyer_batiment", label: "Loyer bâtiment", section: "charges_ext", unit: "eur" },
  { key: "ch_loyer_materiel", label: "Loyer matériel", section: "charges_ext", unit: "eur" },
  { key: "ch_entretien", label: "Entretien immo/mat", section: "charges_ext", unit: "eur", aliases: ["ENTRETIEN IMMO MAT", "ENTRETIEN"] },
  { key: "ch_assurance", label: "Assurance", section: "charges_ext", unit: "eur", aliases: ["ASSURANCES"] },
  { key: "ch_commissions_assurances", label: "Commissions aux assurances", section: "charges_ext", unit: "eur", aliases: ["COMMISSIONS ASSURANCES"] },
  { key: "ch_honoraires", label: "Honoraires", section: "charges_ext", unit: "eur" },
  { key: "ch_annonces_pub", label: "Annonces + pub", section: "charges_ext", unit: "eur", aliases: ["ANNONCES PUB", "PUBLICITE"] },
  { key: "ch_transport", label: "Transport", section: "charges_ext", unit: "eur", aliases: ["TRANSPORTS"] },
  { key: "ch_frais_dep", label: "Frais dep", section: "charges_ext", unit: "eur", aliases: ["FRAIS DEPLACEMENT", "FRAIS DEP"] },
  { key: "ch_reception_formation", label: "Réception / frs / formation", section: "charges_ext", unit: "eur", aliases: ["RECEPTION FRS FORMATION", "FORMATION"] },
  { key: "ch_timbres_tel", label: "Timbres + tel", section: "charges_ext", unit: "eur", aliases: ["TIMBRES TEL", "TELEPHONE"] },
  { key: "ch_frais_banque", label: "Frais banque", section: "charges_ext", unit: "eur", aliases: ["FRAIS BANCAIRES"] },
  { key: "ch_divers", label: "Divers", section: "charges_ext", unit: "eur" },
  { key: "ch_total", label: "Total Charges ext", section: "charges_ext", unit: "eur", aliases: ["TOTAL CHARGES EXTERNES", "TOTAL CHARGES EXT"] },

  // F — Achats non stockés / Fournitures
  { key: "fo_elec", label: "ELEC", section: "fournitures", unit: "eur", aliases: ["ELECTRICITE"] },
  { key: "fo_gaz", label: "GAZ", section: "fournitures", unit: "eur" },
  { key: "fo_eau", label: "EAU", section: "fournitures", unit: "eur" },
  { key: "fo_carb_fioul", label: "CARB + FIOUL", section: "fournitures", unit: "eur", aliases: ["CARB FIOUL", "CARBURANT FIOUL"] },
  { key: "fo_petit_outillage", label: "PETIT OUTILLAGE", section: "fournitures", unit: "eur", aliases: ["OUTILLAGE"] },
  { key: "fo_fournitures_adm", label: "FOURNITURES ADM", section: "fournitures", unit: "eur", aliases: ["FOURNITURES ADMINISTRATIVES"] },
  { key: "fo_total", label: "Total achats non stockés", section: "fournitures", unit: "eur", aliases: ["TOTAL ACHATS", "TOTAL ACHATS NON STOCKES"] },

  // G — Charges fixes / sociales
  { key: "fx_subventions", label: "Subventions", section: "fixes", unit: "eur" },
  { key: "fx_impots_taxes", label: "Impôts et taxes", section: "fixes", unit: "eur", aliases: ["IMPOTS TAXES"] },
  { key: "fx_salaires", label: "Salaires", section: "fixes", unit: "eur" },
  { key: "fx_charges", label: "Charges", section: "fixes", unit: "eur", aliases: ["CHARGES SOCIALES"] },
  { key: "fx_total_sociales", label: "Total charges sociales", section: "fixes", unit: "eur", aliases: ["TOTAL SOCIALES"] },
  { key: "fx_total", label: "Total charges fixes", section: "fixes", unit: "eur", aliases: ["TOTAL CHARGES FIXES"] },

  // H — VO
  { key: "vo_marge_brute", label: "Marge brute VO", section: "vo", unit: "eur", aliases: ["MARGE BRUTE"] },
  { key: "vo_nette_mo", label: "Nette + MO VO", section: "vo", unit: "eur", aliases: ["NETTE MO VO", "NETTE MO"] },
  { key: "vo_marge_nette", label: "Marge nette VO", section: "vo", unit: "eur", aliases: ["MARGE NETTE"] },
  { key: "vo_comm_diac", label: "Comm DIAC", section: "vo", unit: "eur", aliases: ["COMMISSION DIAC", "DIAC"] },
  { key: "vo_comm_vn_sarda", label: "Comm VN + SARDA", section: "vo", unit: "eur", aliases: ["COMM VN SARDA", "SARDA"] },
  { key: "vo_total_ventes_comm", label: "Total Ventes / commissions", section: "vo", unit: "eur", aliases: ["TOTAL VENTES COMMISSIONS"] },
  { key: "vo_pr_sur_vo_vn", label: "PR sur VO/VN", section: "vo", unit: "eur", aliases: ["PR SUR VO VN"] },
  { key: "vo_mo_sur_vo_vn", label: "MO sur VO/VN", section: "vo", unit: "eur", aliases: ["MO SUR VO VN"] },
  { key: "vo_frais_remise_etat", label: "Frais remise en état VO", section: "vo", unit: "eur", aliases: ["FRAIS REMISE EN ETAT", "REMISE EN ETAT"] },
  { key: "vo_ca_ht", label: "CA VO HT", section: "vo", unit: "eur" },
  { key: "vo_ca_ttc", label: "CA VO TTC", section: "vo", unit: "eur" },
  { key: "vo_carte_grise", label: "Carte grise", section: "vo", unit: "eur", aliases: ["CARTES GRISES"] },
  { key: "vo_frais_immat", label: "Frais immatriculation", section: "vo", unit: "eur", aliases: ["FRAIS IMMAT"] },
];

/** Normalisation d'un libellé : accents, casse, ponctuation et espaces supprimés. */
export function normLabel(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const BY_NORM = new Map<string, Indicator>();
for (const ind of INDICATORS) {
  for (const label of [ind.label, ...(ind.aliases ?? [])]) {
    const k = normLabel(label);
    if (!BY_NORM.has(k)) BY_NORM.set(k, ind);
  }
}

export function indicatorForLabel(label: unknown): Indicator | null {
  return BY_NORM.get(normLabel(label)) ?? null;
}

export function indicatorByKey(key: string): Indicator | null {
  return INDICATORS.find((i) => i.key === key) ?? null;
}

/** KPI principaux du tableau de bord. */
export const MAIN_KPIS: string[] = [
  "ca_total",
  "ca_mo",
  "ca_pr",
  "entrees_toutes",
  "heures_achetees",
  "heures_passees",
  "heures_facturees",
  "realisation",
  "gain_apv",
  "resultat",
];
