import { runPaidAi } from "./ai-usage.server";
import { parseJsonBlock, VISION_MODEL } from "./ocr.server";

/**
 * Lecture du compteur d'une photo déjà stockée.
 * L'empreinte de cache est le CHEMIN de stockage (stable), jamais l'URL signée :
 * une même photo n'est donc jamais analysée deux fois.
 */
export async function readStoredOdometer(signedUrl: string, storagePath: string) {
  const prompt = `Lis le kilométrage total affiché sur ce compteur de véhicule (pas le trip / journalier).
Réponds STRICTEMENT en JSON : {"mileage":78452,"unit":"km"}
Si illisible : {"mileage":null,"unit":null}`;

  const result = await runPaidAi({
    feature: "ocr_compteur",
    fingerprintSeed: storagePath,
    model: VISION_MODEL,
    entity: storagePath,
    body: {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: signedUrl } },
          ],
        },
      ],
    },
  });

  if (!result.ok) return { ok: false as const, error: result.error, mileage: 0 };
  const parsed = parseJsonBlock(result.content);
  const raw = parsed?.["mileage"];
  const mileage = typeof raw === "number" ? Math.round(raw) : 0;
  if (!mileage) return { ok: false as const, error: "Kilométrage non détecté.", mileage: 0 };
  return { ok: true as const, error: "", mileage };
}
