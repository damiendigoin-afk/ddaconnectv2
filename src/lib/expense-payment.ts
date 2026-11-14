export const CARREFOUR_CLIPRO_PAYMENT_SOURCE = "carrefour_clipro" as const;

export type ExpensePaymentFields = {
  merchant?: unknown;
  merchant_header?: unknown;
  raw_text?: unknown;
  payment_text?: unknown;
};

function normalizedEvidence(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/1/g, "I")
        .replace(/0/g, "O")
        .replace(/[^A-Z]+/g, " ")
        .trim()
    : "";
}

/**
 * CLIPRO n'est un indice de compte professionnel que pour Carrefour et lorsqu'un
 * libellé de paiement voisin rend le contexte explicite. Aucun sous-compte n'est déduit.
 */
export function detectCarrefourCliproPayment(fields: ExpensePaymentFields, localText?: string): "en_compte" | null {
  const evidence = [localText, fields.merchant, fields.merchant_header, fields.raw_text, fields.payment_text]
    .map(normalizedEvidence)
    .filter(Boolean)
    .join(" ");
  if (!/\bCARREFOUR\b/.test(evidence)) return null;

  // CLIPRO, CLI PRO, CLIP PRO, espaces/casse et confusions OCR usuelles 1/I et 0/O.
  const clipro = /C\s*L\s*I\s*P\s*P?\s*R\s*O/g;
  const paymentContext = /\b(?:PAIEMENT|PAYEMENT|REGLEMENT|MODE DE PAIEMENT|MOYEN DE PAIEMENT)\b/;
  for (const match of evidence.matchAll(clipro)) {
    const index = match.index ?? 0;
    const context = evidence.slice(Math.max(0, index - 90), index + match[0].length + 90);
    if (paymentContext.test(context)) return "en_compte";
  }
  return null;
}

/** Une correction manuelle du règlement n'est jamais remplacée par le résultat du scan. */
export function paymentMethodAfterScan(current: string, detected: string | null, userModified: boolean): string {
  return !userModified && detected === "en_compte" ? "en_compte" : current;
}
