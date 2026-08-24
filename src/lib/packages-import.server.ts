/** Analyse serveur d'un mémento forfaits Renault / Dacia (PDF ou image). */
import { askVision, parseJsonBlock } from "./ocr.server";

const PROMPT = `Tu analyses un MÉMENTO FORFAITS après-vente automobile (Renault ou Dacia, France).
Objectif : extraire les forfaits tarifaires ligne par ligne, exactement tels qu'ils figurent au document.

RÈGLES ABSOLUES :
- N'invente JAMAIS un forfait, un prix, un temps ou un code. Si une ligne, une page ou un tableau
  n'est pas lisible de façon fiable, ne la produis pas : décris-la dans "warnings"
  (ex: "page 4 : tableau non exploitable automatiquement").
- Ne déduis pas un forfait absent du document (batterie, pneumatiques...).
- "price_basis" = "ttc" pour les mémentos Public, "ht" pour les mémentos Pro / LLD ; si le document
  l'indique explicitement, respecte le document.
- Un prix par ligne, en nombre décimal (point décimal), sans symbole ni séparateur de milliers.

Réponds STRICTEMENT en JSON :
{"version":"version ou date du mémento si imprimée, sinon null",
 "lines":[{"operation_code":"","label":"","brand":null,"model":null,"segment":null,
   "energies":null,"price":null,"price_basis":"ttc","hours":null,"parts_ht":null,
   "year_from":null,"year_to":null,"page":null,"notes":null}],
 "warnings":["pages ou tableaux non exploitables"]}`;

export async function analyzePackageMemento(dataUrl: string, filename?: string) {
  const res = await askVision(PROMPT, dataUrl, filename);
  if (!res.ok) return { ok: false as const, error: res.error, json: "" };
  const parsed = parseJsonBlock(res.content);
  if (!parsed) {
    return {
      ok: false as const,
      error: "Document non exploitable automatiquement : aucune table de forfaits reconnue.",
      json: "",
    };
  }
  return { ok: true as const, error: "", json: JSON.stringify(parsed) };
}
