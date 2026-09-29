import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { readDocument } from "./doc-pipeline.server";
import { reconcileExpenseVat } from "./doc-rules";

/**
 * Lecture d'un justificatif de note de frais (ticket, facture, reçu).
 * Réutilise le service d'analyse visuelle déjà en place (cache + budget).
 * Jamais bloquant : en cas d'échec, la saisie manuelle reste disponible.
 */
export const ocrExpenseReceipt = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ dataUrl: z.string().min(10), filename: z.string().optional(), text: z.string().max(40000).optional() }).parse(data),
  )
  .handler(async ({ data }) => {
    const prompt = `Tu lis un justificatif de dépense français (ticket de caisse, reçu, facture, note d'hôtel,
ticket de péage ou de carburant). Réponds STRICTEMENT en JSON :
{"merchant":null,"date":null,"amount_ttc":null,"vat_amount":null,"vat_rate":null,"category":null,"raw_text":null}
merchant = enseigne/fournisseur. date au format ISO YYYY-MM-DD. amount_ttc = total payé TTC (nombre, point décimal).
vat_amount = montant de TVA si lisible, vat_rate = taux en % si lisible.
category parmi : restaurant, carburant, peage, parking, hotel, fournitures, achat_divers, autre.
raw_text = les quelques lignes d'en-tête du ticket. Mets null pour tout ce qui n'est pas lisible. N'invente rien.`;
    const r = await readDocument({ feature: "expense_receipt", kind: "expense", prompt, text: data.text, dataUrl: data.dataUrl, filename: data.filename });
    const parsed = reconcileExpenseVat(r.fields as Record<string, unknown>, data.text);
    if (!Object.values(parsed).some((v) => v != null && v !== "")) return { ok: false as const, error: "Justificatif illisible : saisissez les informations.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });
