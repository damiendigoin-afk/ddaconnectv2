import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({ dataUrl: z.string().min(10), filename: z.string().optional(), text: z.string().max(40000).optional() });

const PROMPT = `Tu lis une LISTE DE PIÈCES automobile (France) : rapport / procès-verbal d'expertise, devis Ixellio/ETAI, devis carrosserie.
L'émetteur (cabinet d'expertise, garage) n'est JAMAIS un fournisseur. Les prix lus sont des tarifs / prix de vente, jamais des prix d'achat.
Réponds STRICTEMENT en JSON compact :
{"source_type":"expertise|ixellio|other","source_label":null,"plate":null,"or_number":null,
"lines":[{"designation":"","reference":null,"quantity":1,"source_price_ht":null,"source_operation":null,"item_type":"part|consumable|fee|service"}]}
- Uniquement les besoins d'approvisionnement : pièces (opérations E, O, EP), consommables (agrafes, rivets, plaque police), frais (port, ERD), service (prêt VDR).
- N'inclus JAMAIS les opérations atelier sans pièce : R, D, C, P, G, réparation, peinture, dépose/repose, contrôle, diagnostic, calibrage, essai, temps.
- La référence peut être imprimée en fin de ligne au lieu de la colonne « Réf. Constr. » : rattache-la à la bonne ligne.
- quantity = 1 si absente. Nombres avec un point décimal. N'invente rien.`;

export const readProcurementDoc = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data }) => {
    const { parseProcurementText, procurementNeedsAi, fromAiJson } = await import("./procurement-parse");
    const rules = parseProcurementText(data.text ?? "");
    if (!procurementNeedsAi(rules, data.text)) return { ok: true as const, route: "ocr_rules", list: rules, error: "" };
    const { askVision, parseJsonBlock } = await import("./ocr.server");
    const photo = data.dataUrl.startsWith("data:image");
    const res = await askVision(PROMPT, data.dataUrl, data.filename, "procurement_list", { reasoning_effort: "low", max_tokens: 4000 }, photo);
    const j = res.ok ? parseJsonBlock(res.content) : null;
    if (!j) return { ok: false as const, route: "ocr_rules", list: rules, error: res.ok ? "Lecture IA illisible : complétez la liste à la main." : res.error };
    return { ok: true as const, route: "ai_vision_fallback", list: fromAiJson(j, rules), error: "" };
  });
