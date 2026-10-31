/**
 * Devis pneus — Site web : configuration administrateur (aucun calcul ici).
 * Le futur calcul web réutilisera priceTireLine / applyMargin / mountPriceFor.
 * Marge et montage sont aujourd'hui communs à tous les sites (commercial_settings) ;
 * seul le compte fournisseur (Districash) est rattaché au site. Aucun état « connecté » n'est
 * déclaré sans contrôle réel enregistré.
 */
import { QUOTE_TIRE_SUPPLIERS, type QuoteTireSupplierKey } from "./tires";

/** Les 6 cases fixes du devis web : aucune substitution silencieuse entre cases. */
export const WEB_QUOTE_CASES = [
  { season: "ete", tier: "entree" },
  { season: "ete", tier: "milieu" },
  { season: "ete", tier: "haut" },
  { season: "quatre_saisons", tier: "entree" },
  { season: "quatre_saisons", tier: "milieu" },
  { season: "quatre_saisons", tier: "haut" },
] as const;

/** Fournisseurs web : exclusivement ceux réellement supportés par le moteur. */
export const WEB_SUPPLIERS = QUOTE_TIRE_SUPPLIERS.filter((s) => s.available);

export function webSupplierKey(v: string | null | undefined): QuoteTireSupplierKey | null {
  return WEB_SUPPLIERS.some((s) => s.key === v) ? (v as QuoteTireSupplierKey) : null;
}

/** Point d'entrée public sécurisé : inexistant à ce stade. */
export const PUBLIC_ENDPOINT_READY = false;

export type WebConnectionState = "non_selectionne" | "site_requis" | "aucune_connexion_requise" | "controle_ok" | "echec" | "jamais_controle" | "identifiants_absents" | "lecture_impossible";

export type ConnectionInput = {
  supplier: QuoteTireSupplierKey | null;
  siteId: string | null;
  centrale?: { status: string | null; lastOkAt: string | null; message: string | null } | null;
  districashError?: boolean;
  districash?: { configured: boolean; lastTestOk: boolean | null; lastTestAt: string | null } | null;
};

export function webConnectionState(i: ConnectionInput): { state: WebConnectionState; label: string } {
  if (!i.supplier) return { state: "non_selectionne", label: "Aucun fournisseur web sélectionné." };
  if (!i.siteId) return { state: "site_requis", label: "Choisissez l'établissement de rattachement." };
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

export function canActivateWeb(): { ok: boolean; reason: string } {
  if (!PUBLIC_ENDPOINT_READY)
    return {
      ok: false,
      reason:
        "Activation impossible : le point d'entrée public sécurisé pour le site vitrine n'existe pas encore.",
    };
  return { ok: true, reason: "" };
}
