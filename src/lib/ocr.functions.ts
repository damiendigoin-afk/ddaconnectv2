import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { askVision, parseJsonBlock } from "./ocr.server";

const fileInput = z.object({ dataUrl: z.string().min(10), filename: z.string().optional() });

export const ocrRepairOrder = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu analyses un ordre de réparation d'un garage automobile français.
Extrais uniquement ce que tu lis réellement. Réponds STRICTEMENT en JSON avec cette forme :
{"client":{"account_number":null,"last_name":null,"first_name":null,"address":null,"address_extra":null,"postal_code":null,"city":null,"phone":null,"mobile":null,"email":null},
"vehicle":{"plate":null,"vin":null,"brand":null,"model":null,"mileage":null,"first_registration":null},
"order":{"or_number":null,"or_date":null,"client_remarks":null,"requested_work":null,"entry_at":null,"delivery_at":null},
"uncertain":["liste des chemins de champs peu lisibles, ex: vehicle.vin"]}
Dates au format ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm). mileage = entier sans espace. Mets null si absent.`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Document illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

export const ocrPlate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Lis la plaque d'immatriculation visible sur cette photo.
Réponds STRICTEMENT en JSON : {"plate":"AB-123-CD","confidence":0.0}
Si aucune plaque lisible : {"plate":null,"confidence":0}`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, plate: "" };
    const parsed = parseJsonBlock(result.content);
    const plate = typeof parsed?.["plate"] === "string" ? (parsed["plate"] as string) : "";
    if (!plate) return { ok: false as const, error: "Plaque non détectée.", plate: "" };
    return { ok: true as const, error: "", plate };
  });

export const ocrOdometer = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Lis le kilométrage total affiché sur ce compteur de véhicule (pas le trip / journalier).
Réponds STRICTEMENT en JSON : {"mileage":78452,"unit":"km"}
Si illisible : {"mileage":null,"unit":null}`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, mileage: 0 };
    const parsed = parseJsonBlock(result.content);
    const raw = parsed?.["mileage"];
    const mileage = typeof raw === "number" ? Math.round(raw) : 0;
    if (!mileage) return { ok: false as const, error: "Kilométrage non détecté.", mileage: 0 };
    return { ok: true as const, error: "", mileage };
  });