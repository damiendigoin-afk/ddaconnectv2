import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { readDocument } from "./doc-pipeline.server";
import { reconcileExpenseVat } from "./doc-rules";
import { CARREFOUR_CLIPRO_PAYMENT_SOURCE, detectCarrefourCliproPayment } from "./expense-payment";
import { normalizeExpenseExtract } from "./expense-validate";

/**
 * Lecture d'un justificatif de note de frais (ticket, facture, reçu).
 * Photos et PDF scannés : une vision essentielle d'abord via le pipeline commun (cache + budget).
 * PDF avec vraie couche texte : règles natives d'abord. La saisie manuelle reste toujours disponible.
 */
export const ocrExpenseReceipt = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ dataUrl: z.string().min(10), filename: z.string().optional(), text: z.string().max(40000).optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    const prompt = `Tu lis un ticket ou justificatif de dépense français. Réponds STRICTEMENT en JSON :
{"merchant":null,"merchant_header":null,"date":null,"transaction_time":null,"amount_ttc":null,"amount_ht":null,"vat_amount":null,"vat_amount_source":null,"vat_rate":null,"vat_lines":[],"quantity_litres":null,"unit_price_litre":null,"category":null,"raw_text":null,"payment_text":null}
RÈGLES DE LECTURE IMPÉRATIVES :
- merchant = nom d'enseigne de l'en-tête ; merchant_header = identité commerciale lisible dans l'en-tête. Ne mets jamais un téléphone, SIRET ou une adresse dans merchant.
- date = date de transaction au format YYYY-MM-DD ; transaction_time = heure de transaction HH:MM. N'utilise jamais une date d'expiration, de validité ou une date sans lien avec la transaction.
- amount_ttc = TOTAL TTC / MONTANT À PAYER réellement payé. amount_ht = total HT seulement s'il est imprimé et certain.
- vat_amount = montant de TVA EN EUR, jamais le taux. vat_rate = taux EN % seulement s'il est réellement unique sur le ticket.
- vat_amount_source = "ticket" uniquement si le montant TVA ou son total est explicitement lisible/déterminable à partir des lignes TVA ; sinon null. Ne calcule pas toi-même une TVA théorique.
- vat_lines = lignes TVA explicitement lues sous la forme [{"rate":20,"amount":4.79}]. Pour un ticket multi-taux, vat_rate = null ; vat_amount = total TVA seulement s'il est explicitement déterminable, sinon null.
- quantity_litres = quantité de carburant en litres avec unité L explicite ; unit_price_litre = prix au litre seulement si l'unité est explicite. Ne confonds jamais quantité, prix, taux, SIRET, téléphone ou numéro de ticket.
- category parmi : restaurant, carburant, peage, parking, hotel, fournitures, achat_divers, autre.
- raw_text = quelques lignes d'en-tête utiles à l'identification du commerçant.
- payment_text = lignes brutes du bloc de règlement. Chez Carrefour, « PAIEMENT CLIPRO », « CLIP PRO » ou « CLI PRO » identifie notre compte professionnel : conserve cette mention et son contexte PAIEMENT pour la règle déterministe serveur qui préremplira En compte. Ne l'applique pas hors Carrefour. Ne déduis jamais un sous-compte Direction / VO / Atelier à partir de CLIPRO : le compte reste un choix manuel obligatoire.
Mets null pour toute valeur douteuse ou non lisible. N'invente et ne déduis jamais une date, une TVA, un taux, une quantité ou un montant.`;
    const r = await readDocument({ feature: "expense_receipt", kind: "expense", prompt, text: data.text, dataUrl: data.dataUrl, filename: data.filename });
    const reconciled = reconcileExpenseVat(r.fields as Record<string, unknown>, data.text);
    const parsed = normalizeExpenseExtract(reconciled);
    const detectedPayment = detectCarrefourCliproPayment(reconciled, data.text);
    const output = detectedPayment
      ? { ...parsed, payment_method: detectedPayment, payment_method_source: CARREFOUR_CLIPRO_PAYMENT_SOURCE }
      : parsed;
    if (r.visionFailed) return { ok: false as const, error: "Lecture automatique indisponible : saisissez les informations à la main.", json: "" };
    if (r.missing.length) return { ok: false as const, error: `Lecture incomplète (${r.missing.join(", ")}) : complétez les informations à la main.`, json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(output) };
  });
