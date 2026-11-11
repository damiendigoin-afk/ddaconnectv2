/**
 * Qualification tarifaire du catalogue pièces IXELLIO UNIQUEMENT (déclaration du gérant) :
 * montants affichés = prix public constructeur HT. Jamais un prix d'achat garage ; ne s'applique
 * à aucun autre fournisseur ou canal.
 */
export const IXELLIO_TARIFF = {
  basis: "HT",
  tariffCategory: "public_constructeur",
  isPublic: true,
  isPurchase: false,
  qualificationSource: "déclaration du gérant - tarif catalogue IXELLIO affiché prix public constructeur HT",
} as const;
export type IxellioTariff = typeof IXELLIO_TARIFF;
export const IXELLIO_TARIFF_LABEL = "HT · prix public constructeur (pas un prix d'achat)";
