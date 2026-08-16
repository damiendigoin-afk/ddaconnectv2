/** Analyses IA du module Carrosserie / Magasin (rapports experts, avoirs). */
import { askVision, parseJsonBlock } from "./ocr.server";

const EXPERT_PROMPT = `Tu analyses un RAPPORT D'EXPERTISE automobile français.
Le format peut être DEKRA, BCA, Roadia/AlphaExpert, Cabinet indépendant ou tout autre format : ne suppose aucun gabarit,
lis le document tel qu'il est. N'invente jamais une valeur : si tu n'es pas certain, mets null et cite le champ dans "uncertain".
Réponds STRICTEMENT en JSON :
{"expert":null,"firm":null,"insurer":null,"claim_number":null,"mission_number":null,
"report_date":null,"visit_date":null,
"vehicle":{"brand":null,"model":null,"plate":null,"vin":null,"mileage":null,"first_registration":null},
"franchise":null,"vat_rate":null,"depreciation":null,
"rates":{"t1":null,"t2":null,"t3":null,"paint":null,"mechanic":null,"ingredients":null},
"times":{"sheetmetal":null,"paint":null,"mechanic":null,"total":null},
"parts":[{"reference":null,"label":null,"quantity":null,"unit_price":null,"discount":null}],
"totals":{"ht":null,"ttc":null,"insurer_part":null,"client_part":null,"theoretical_days":null},
"vge":false,"comments":null,
"instructions":["consignes explicites de l'expert, une par entrée, ex: prévenir l'expert après démontage"],
"uncertain":["chemins des champs peu lisibles"]}
Montants en nombres décimaux (point décimal), sans symbole. Dates ISO YYYY-MM-DD.`;

export async function analyzeExpertReport(dataUrl: string, filename?: string) {
  const res = await askVision(EXPERT_PROMPT, dataUrl, filename);
  if (!res.ok) return { ok: false as const, error: res.error, json: "" };
  const parsed = parseJsonBlock(res.content);
  if (!parsed) return { ok: false as const, error: "Rapport illisible.", json: "" };
  return { ok: true as const, error: "", json: JSON.stringify(parsed) };
}

const CREDIT_PROMPT = `Tu analyses un AVOIR FOURNISSEUR de pièces automobiles (tout format).
Réponds STRICTEMENT en JSON :
{"supplier":null,"number":null,"date":null,"total_amount":null,
"lines":[{"reference":null,"label":null,"quantity":null,"amount":null}],
"uncertain":[]}
Montants décimaux avec point, dates ISO. null si non lisible, n'invente rien.`;

export async function analyzeCreditNote(dataUrl: string, filename?: string) {
  const res = await askVision(CREDIT_PROMPT, dataUrl, filename);
  if (!res.ok) return { ok: false as const, error: res.error, json: "" };
  const parsed = parseJsonBlock(res.content);
  if (!parsed) return { ok: false as const, error: "Avoir illisible.", json: "" };
  return { ok: true as const, error: "", json: JSON.stringify(parsed) };
}

const SCAN_PROMPT = `Cette photo montre soit un ordre de réparation (OR) de garage, soit une plaque d'immatriculation,
soit une étiquette de pièce détachée. Détermine seul de quoi il s'agit.
Réponds STRICTEMENT en JSON : {"kind":"or|plate|part|unknown","plate":null,"or_number":null,"part_reference":null,"part_label":null}
N'invente rien, mets null si illisible.`;

export async function analyzeScan(dataUrl: string, filename?: string) {
  const res = await askVision(SCAN_PROMPT, dataUrl, filename);
  if (!res.ok) return { ok: false as const, error: res.error, json: "" };
  const parsed = parseJsonBlock(res.content);
  if (!parsed) return { ok: false as const, error: "Image illisible.", json: "" };
  return { ok: true as const, error: "", json: JSON.stringify(parsed) };
}
