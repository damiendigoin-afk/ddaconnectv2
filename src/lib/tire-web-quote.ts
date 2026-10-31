/**
 * Devis pneus — Site web : configuration administrateur (aucun calcul ici).
 * Le calcul web passe par runTopPrice (tire-top-price-core.ts), comme l'écran interne.
 * Marge et montage sont aujourd'hui communs à tous les sites (commercial_settings) ;
 * seul le compte fournisseur (Districash) est rattaché au site. Aucun état « connecté » n'est
 * déclaré sans contrôle réel enregistré.
 */
import type { QuoteTireSupplierKey } from "./tires";

/** Les 6 cases fixes du devis web : aucune substitution silencieuse entre cases. */
export const WEB_QUOTE_CASES = [
  { season: "ete", tier: "entree" },
  { season: "ete", tier: "milieu" },
  { season: "ete", tier: "haut" },
  { season: "quatre_saisons", tier: "entree" },
  { season: "quatre_saisons", tier: "milieu" },
  { season: "quatre_saisons", tier: "haut" },
] as const;

/**
 * Mode web : exclusivement « Top prix » (hors QuoteTireSupplierKey, qui reste
 * réservé aux fournisseurs internes). Aucune sélection implicite.
 */
export type WebSupplierKey = "top_prix";
export const WEB_SUPPLIERS: { key: WebSupplierKey; label: string }[] = [
  { key: "top_prix", label: "Top prix — tous fournisseurs, moins cher par gamme" },
];

export function webSupplierKey(v: string | null | undefined): WebSupplierKey | null {
  return v === "top_prix" ? "top_prix" : null;
}

export type WebConnectionState = "non_selectionne" | "site_requis" | "aucune_connexion_requise" | "controle_ok" | "echec" | "jamais_controle" | "identifiants_absents" | "lecture_impossible";

export type ConnectionInput = {
  supplier: QuoteTireSupplierKey | WebSupplierKey | null;
  siteId: string | null;
  centrale?: { status: string | null; lastOkAt: string | null; message: string | null } | null;
  districashError?: boolean;
  districash?: { configured: boolean; lastTestOk: boolean | null; lastTestAt: string | null } | null;
};

export function webConnectionState(i: ConnectionInput): { state: WebConnectionState; label: string } {
  if (!i.supplier) return { state: "non_selectionne", label: "Aucun fournisseur web sélectionné." };
  if (!i.siteId) return { state: "site_requis", label: "Choisissez l'établissement de rattachement." };
  if (i.supplier === "top_prix") {
    // Top prix consulte Districash avec le compte de l'établissement choisi.
    if (i.districashError) return { state: "lecture_impossible", label: "État Districash illisible (erreur de lecture), réessayez." };
    if (!i.districash?.configured) return { state: "identifiants_absents", label: "Identifiants Districash absents pour cet établissement : activation impossible." };
    if (i.districash.lastTestOk === true && i.districash.lastTestAt)
      return { state: "controle_ok", label: `Districash : dernier test réussi le ${new Date(i.districash.lastTestAt).toLocaleString("fr-FR")}` };
    if (i.districash.lastTestOk === false) return { state: "echec", label: "Districash : dernier test de connexion en échec." };
    return { state: "jamais_controle", label: "Districash : connexion jamais testée." };
  }
  if (i.supplier === "catalogue_local")
    return { state: "aucune_connexion_requise", label: "Catalogue local : aucune connexion externe." };
  if (i.supplier === "centralepneus") {
    const c = i.centrale;
    if (c?.status === "operationnel" && c.lastOkAt)
      return { state: "controle_ok", label: `Dernière consultation réussie : ${new Date(c.lastOkAt).toLocaleString("fr-FR")}` };
    if (c?.status === "indisponible") return { state: "echec", label: "Dernière consultation en échec." };
    return { state: "jamais_controle", label: "Aucune consultation enregistrée." };
  }
  if (i.districashError) return { state: "lecture_impossible", label: "État Districash illisible (erreur de lecture), réessayez." };
  const d = i.districash;
  if (!d?.configured) return { state: "identifiants_absents", label: "Identifiants Districash absents pour ce site." };
  if (d.lastTestOk === true && d.lastTestAt)
    return { state: "controle_ok", label: `Dernier test réussi : ${new Date(d.lastTestAt).toLocaleString("fr-FR")}` };
  if (d.lastTestOk === false) return { state: "echec", label: "Dernier test de connexion en échec." };
  return { state: "jamais_controle", label: "Connexion jamais testée." };
}

