/**
 * Analyse visuelle des pneumatiques — modèle visuel OpenAI via la passerelle IA.
 *
 * Le modèle ne décide jamais seul : il restitue ce qu'il lit, ce qu'il estime et
 * ce qu'il ne peut pas lire. La grille d'usure, la sévérité et la validation
 * humaine sont appliquées côté application.
 */
import type { TireLabelAi, TireWheelAi } from "./tire-types";

export type { TireLabelAi, TireWheelAi };

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Modèle visuel OpenAI utilisé pour l'analyse pneumatique. */
export const TIRE_VISION_MODEL = "openai/gpt-5-mini";

type Block = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function askOpenAiVision(prompt: string, images: string[]) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { ok: false as const, error: "Analyse automatique non configurée." };

  const blocks: Block[] = [{ type: "text", text: prompt }];
  for (const url of images) blocks.push({ type: "image_url", image_url: { url } });

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: TIRE_VISION_MODEL,
      messages: [{ role: "user", content: blocks }],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("tire vision error", res.status, detail);
    if (res.status === 429) return { ok: false as const, error: "Trop de demandes, réessayez dans un instant." };
    if (res.status === 402) return { ok: false as const, error: "Crédits d'analyse épuisés." };
    if (res.status === 403) return { ok: false as const, error: "Analyse visuelle bloquée par la configuration." };
    return { ok: false as const, error: "L'analyse automatique a échoué." };
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { ok: true as const, content: json.choices?.[0]?.message?.content ?? "" };
}

function parseJson(content: string): Record<string, unknown> | null {
  const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const WHEEL_PROMPT = `Tu es un technicien pneumatique français. Tu analyses les photos d'UNE SEULE roue :
la première montre la roue complète et le flanc, la deuxième la bande de roulement, les suivantes
sont des vues complémentaires facultatives.

Règle absolue : n'invente jamais une caractéristique, une dimension, une marque ou une mesure.
Si une information n'est pas lisible, mets null et cite-la dans "unreadable".
Distingue toujours une mesure réelle (jauge/réglette visible sur la photo) d'une estimation visuelle.

Réponds STRICTEMENT en JSON :
{
 "brand": null, "model": null, "size": null, "load_index": null, "speed_index": null,
 "season": null, "dot": null,
 "depth_mm": null, "depth_kind": null,
 "wear": null, "wear_zone": null,
 "cracks": false, "cuts": false, "bulges": false, "foreign_objects": false,
 "sidewall_damage": false, "rim_damage": false,
 "photo_quality": "bonne",
 "confidence": {"brand":"faible","size":"faible","depth_mm":"faible"},
 "observations": [],
 "client_comment": null,
 "unreadable": []
}
- size au format 205/55R16, load_index numérique lu au flanc (ex "91"), speed_index lettre (ex "V").
- season parmi "ete", "quatre_saisons", "hiver" (indices M+S / 3PMSF / mention sur le flanc), sinon null.
- dot = 4 chiffres semaine+année si lisibles.
- depth_kind = "mesure" uniquement si une jauge ou réglette graduée est visible sur la photo, sinon "estimation".
- wear parmi "reguliere" ou "irreguliere" ; wear_zone parmi "centrale", "interieure", "exterieure", "epaulement", null.
- photo_quality parmi "bonne", "moyenne", "insuffisante". Mets "insuffisante" si flou, trop sombre,
  surexposé, roue hors cadre, bande de roulement non visible ou marquages totalement illisibles.
- confidence : niveau "elevee" / "moyenne" / "faible" par donnée réellement renseignée.
- foreign_objects = true UNIQUEMENT pour un objet vraisemblablement perforant ou à risque
  (vis, clou, éclat métallique, corps étranger enfoncé). Un gravillon ou un caillou coincé dans une
  sculpture n'est PAS un corps étranger dangereux : laisse false et cite-le dans "observations".
- observations : anomalies visuelles constatées, formulées factuellement, en français.
- client_comment : une phrase compréhensible par un client, sans diagnostic péremptoire.
- N'énonce aucun kilométrage restant et aucune durée de vie.`;

function bool(v: unknown) {
  return v === true;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function analyzeTireWheel(images: string[]) {
  const result = await askOpenAiVision(WHEEL_PROMPT, images.slice(0, 5));
  if (!result.ok) return { ok: false as const, error: result.error, analysis: null };
  const parsed = parseJson(result.content);
  if (!parsed) return { ok: false as const, error: "Analyse illisible.", analysis: null };

  const depthRaw = parsed["depth_mm"];
  const quality = str(parsed["photo_quality"]);
  const analysis: TireWheelAi = {
    brand: str(parsed["brand"]),
    model: str(parsed["model"]),
    size: str(parsed["size"]),
    load_index: str(parsed["load_index"]),
    speed_index: str(parsed["speed_index"]),
    season: str(parsed["season"]),
    dot: str(parsed["dot"]),
    depth_mm: typeof depthRaw === "number" && depthRaw > 0 ? Math.round(depthRaw * 10) / 10 : null,
    depth_kind: parsed["depth_kind"] === "mesure" ? "mesure" : parsed["depth_kind"] === "estimation" ? "estimation" : null,
    wear: parsed["wear"] === "reguliere" || parsed["wear"] === "irreguliere" ? parsed["wear"] : null,
    wear_zone: str(parsed["wear_zone"]),
    cracks: bool(parsed["cracks"]),
    cuts: bool(parsed["cuts"]),
    bulges: bool(parsed["bulges"]),
    foreign_objects: bool(parsed["foreign_objects"]),
    sidewall_damage: bool(parsed["sidewall_damage"]),
    rim_damage: bool(parsed["rim_damage"]),
    photo_quality: quality === "insuffisante" || quality === "moyenne" ? quality : "bonne",
    confidence: (parsed["confidence"] as Record<string, string> | undefined) ?? {},
    observations: Array.isArray(parsed["observations"])
      ? (parsed["observations"] as unknown[]).filter((o): o is string => typeof o === "string")
      : [],
    client_comment: str(parsed["client_comment"]),
    unreadable: Array.isArray(parsed["unreadable"])
      ? (parsed["unreadable"] as unknown[]).filter((o): o is string => typeof o === "string")
      : [],
    model_used: TIRE_VISION_MODEL,
  };
  return { ok: true as const, error: "", analysis };
}

const LABEL_PROMPT = `Tu lis l'étiquette des dimensions et pressions pneumatiques d'un véhicule
(montant de porte conducteur ou trappe à carburant). N'invente rien : mets null si illisible.

Réponds STRICTEMENT en JSON :
{"size_front":null,"size_rear":null,"load_index_front":null,"speed_index_front":null,
 "load_index_rear":null,"speed_index_rear":null,
 "pressure_front":null,"pressure_rear":null,
 "pressure_front_loaded":null,"pressure_rear_loaded":null,
 "spare_size":null,"spare_pressure":null,
 "readable":true,"unreadable":[]}
Dimensions au format 205/55R16. Pressions en bar avec un point décimal (ex 2.4).
readable = false si l'étiquette est présente mais illisible.`;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export async function analyzeTireLabel(images: string[]) {
  const result = await askOpenAiVision(LABEL_PROMPT, images.slice(0, 3));
  if (!result.ok) return { ok: false as const, error: result.error, label: null };
  const parsed = parseJson(result.content);
  if (!parsed) return { ok: false as const, error: "Étiquette illisible.", label: null };

  const label: TireLabelAi = {
    size_front: str(parsed["size_front"]),
    size_rear: str(parsed["size_rear"]),
    load_index_front: str(parsed["load_index_front"]),
    speed_index_front: str(parsed["speed_index_front"]),
    load_index_rear: str(parsed["load_index_rear"]),
    speed_index_rear: str(parsed["speed_index_rear"]),
    pressure_front: num(parsed["pressure_front"]),
    pressure_rear: num(parsed["pressure_rear"]),
    pressure_front_loaded: num(parsed["pressure_front_loaded"]),
    pressure_rear_loaded: num(parsed["pressure_rear_loaded"]),
    spare_size: str(parsed["spare_size"]),
    spare_pressure: num(parsed["spare_pressure"]),
    readable: parsed["readable"] !== false,
    unreadable: Array.isArray(parsed["unreadable"])
      ? (parsed["unreadable"] as unknown[]).filter((o): o is string => typeof o === "string")
      : [],
    model_used: TIRE_VISION_MODEL,
  };
  return { ok: true as const, error: "", label };
}
