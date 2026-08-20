import { askVision, parseJsonBlock } from "./ocr.server";

export async function readStoredOdometer(signedUrl: string) {
  const prompt = `Lis le kilométrage total affiché sur ce compteur de véhicule (pas le trip / journalier).
Réponds STRICTEMENT en JSON : {"mileage":78452,"unit":"km"}
Si illisible : {"mileage":null,"unit":null}`;
  const result = await askVision(prompt, signedUrl, "compteur.jpg");
  if (!result.ok) return { ok: false as const, error: result.error, mileage: 0 };
  const parsed = parseJsonBlock(result.content);
  const raw = parsed?.["mileage"];
  const mileage = typeof raw === "number" ? Math.round(raw) : 0;
  if (!mileage) return { ok: false as const, error: "Kilométrage non détecté.", mileage: 0 };
  return { ok: true as const, error: "", mileage };
}