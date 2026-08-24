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

export const ocrTechnicalControl = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Lis la vignette ou le procès-verbal de contrôle technique français visible.
Réponds STRICTEMENT en JSON :
{"ct_due_date":null,"pollution_due_date":null,"vehicle_kind":"vp","confidence":0.0}
ct_due_date = prochaine échéance du contrôle technique au format YYYY-MM-DD.
pollution_due_date = prochaine échéance du contrôle complémentaire pollution, uniquement si elle est réellement indiquée.
vehicle_kind = "vu" pour un véhicule utilitaire soumis au contrôle complémentaire pollution, sinon "vp".
Ne confonds pas date du contrôle réalisé et date limite du prochain contrôle. Mets null si illisible. N'invente rien.`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Dates du contrôle technique illisibles.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
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

/**
 * Lecture générique d'un document métier (plaque, carte grise, OR, avis de sinistre,
 * rapport d'expertise, constat, facture…) pour identifier un véhicule / client / dossier.
 */
export const ocrAnyDocument = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu analyses un document d'atelier automobile français (photo de plaque, carte grise,
ordre de réparation, avis de sinistre, rapport d'expertise, constat, devis, facture, BL, courrier…).
Extrais uniquement ce que tu lis réellement. Réponds STRICTEMENT en JSON :
{"doc_kind":null,"plate":null,"vin":null,"or_number":null,"claim_number":null,"mission_number":null,
"customer_name":null,"customer_phone":null,"customer_email":null,"brand":null,"model":null,
"first_registration":null,"mileage":null,"insurer":null,"expert":null,"amount_ht":null,"document_date":null,
"summary":null}
doc_kind parmi : plaque, carte_grise, or, avis_sinistre, rapport_expertise, constat, devis, facture, bl, courrier, autre.
plate au format AB-123-CD. Dates ISO YYYY-MM-DD. mileage entier. Mets null si absent. N'invente rien.`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Document illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

/**
 * Lecture d'un rapport Winmotor « Ratios de productivité et de rentabilité ».
 * La période est lue DANS le document (titre), jamais déduite du nom de fichier.
 */
export const ocrProductivityReport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu analyses un rapport Winmotor français intitulé
"Ratios de productivité et de rentabilité entre le JJ/MM/AAAA au JJ/MM/AAAA".
Réponds STRICTEMENT en JSON :
{"site":null,"period_start":null,"period_end":null,
"rows":[{"name":"CORDONNIER JULIEN","hours_purchased":112,"hours_spent":112.50,"hours_billed":131.24,"productivity":1.17,"profitability":1.17}],
"totals":{"hours_purchased":null,"hours_spent":null,"hours_billed":null,"productivity":null,"profitability":null}}
Règles impératives :
- period_start et period_end au format ISO YYYY-MM-DD, lus dans le TITRE du document (source de vérité).
- site = raison sociale de l'établissement figurant sur le rapport.
- rows = une ligne par productif (salarié), dans l'ordre du document, en excluant la ligne de total.
- Les nombres utilisent la virgule décimale dans le document : convertis en point (112,50 -> 112.50).
- Une valeur absente, vide ou "-" doit valoir null, JAMAIS 0.
- N'invente aucun productif et ne recalcule aucun ratio : recopie les valeurs du rapport.`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Rapport Winmotor illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });

/**
 * Lecture d'un ticket de testeur de batterie (Midtronics, Bosch, GYS…).
 * Aucune valeur n'est déduite : ce qui n'est pas lisible reste null.
 */
export const ocrBatteryTest = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => fileInput.parse(data))
  .handler(async ({ data }) => {
    const prompt = `Tu lis le ticket ou l'écran d'un testeur de batterie automobile.
Réponds STRICTEMENT en JSON :
{"verdict":"bonne|a_surveiller|a_remplacer|null","voltage":null,"cca_measured":null,"cca_rated":null,"soh_pct":null,"soc_pct":null}
verdict : "bonne" (GOOD / BON), "a_surveiller" (GOOD-RECHARGE / RECHARGE / MARGINAL), "a_remplacer" (REPLACE / BAD / REMPLACER).
Nombres uniquement, sans unité. Mets null pour toute valeur non lisible. N'invente rien.`;
    const result = await askVision(prompt, data.dataUrl, data.filename);
    if (!result.ok) return { ok: false as const, error: result.error, json: "" };
    const parsed = parseJsonBlock(result.content);
    if (!parsed) return { ok: false as const, error: "Ticket batterie illisible.", json: "" };
    return { ok: true as const, error: "", json: JSON.stringify(parsed) };
  });
