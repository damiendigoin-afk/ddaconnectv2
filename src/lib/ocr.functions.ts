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
Dates au format ISO (YYYY-MM-DD ou YYYY-MM-DDTHH:mm). mileage = entier sans espace. Mets null si absent.
IMPORTANT pour "client_remarks" et "requested_work" : ces zones contiennent souvent PLUSIEURS lignes
ou plusieurs demandes distinctes (listes, tirets, numérotation, phrases successives, texte manuscrit).
Restitue l'INTÉGRALITÉ du texte lu, sans résumer ni fusionner, une demande par ligne, séparées par des
retours à la ligne "\\n". Conserve l'ordre du document. N'invente rien.`;
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
/** Lecture d'une carte grise française (certificat d'immatriculation). */
export const ocrRegistrationCard = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu lis un certificat d'immatriculation français (carte grise).
Réponds STRICTEMENT en JSON :
{"plate":null,"vin":null,"brand":null,"model":null,"version":null,"energy":null,
"first_registration":null,"owner_name":null,"color":null}
plate = champ A (format AB-123-CD), vin = champ E, brand = champ D.1, model = champ D.2 ou D.3,
first_registration = champ B au format ISO YYYY-MM-DD, energy = champ P.3, owner_name = champs C.1/C.4.1.
Mets null pour tout champ non lisible. N'invente rien.`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Carte grise illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });
