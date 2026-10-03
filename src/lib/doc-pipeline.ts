/**
 * Pipeline commun de lecture photo/PDF (règle globale DDA Connect) — orchestration pure, testable.
 *  1. texte OCR local / natif PDF (0 crédit) -> règles déterministes ;
 *  2. champs indispensables trouvés => AUCUN appel IA (voie `ocr_rules`) ;
 *  3. sinon, si le repli IA est autorisé : IA sur le TEXTE seul (`ai_text_fallback`) ;
 *  4. vision sur l'image seulement si le texte reste insuffisant (`ai_vision_fallback`).
 */
import { mergeRenaultAi, renaultIncomplete } from "./renault-order";
import { DOC_SPECS, fillMissing, missingFields, type DocKind, type Fields, type RuleContext } from "./doc-rules";

const empty = (v: unknown) => v == null || v === "";
const setAt = (o: Fields, path: string, v: unknown): Fields => {
  const [k, ...rest] = path.split(".");
  const out: Fields = { ...o };
  if (!rest.length) out[k!] = v;
  else out[k!] = setAt(o[k!] && typeof o[k!] === "object" ? (o[k!] as Fields) : {}, rest.join("."), v);
  return out;
};
/** Fusion IA : complète les vides et remplace les champs remplis mais jugés faible confiance. */
function mergeAi(base: Fields, extra: Fields, suspect: string[]): Fields {
  let out = base;
  for (const p of suspect) { const v = at(extra, p); if (!empty(v)) out = setAt(out, p, v); }
  return fillMissing(out, extra);
}
const at = (o: Fields, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Fields)[k] : undefined), o);

const stripMeta = (f: Fields): Fields => { const o = { ...f }; delete o["_suspect"]; return o; };

export type DocRoute = "ocr_rules" | "ai_text_fallback" | "ai_vision_fallback" | "manual";

/**
 * Nature du média lu :
 *  - photo : vraie photo (compteur, OR, BL…) — l'OCR local est souvent partiel ;
 *  - pdf_text : PDF avec vraie couche texte — extraction + règles prioritaires ;
 *  - pdf_scan : PDF scanné sans couche texte exploitable — traité comme une photo ;
 *  - none : texte seul.
 */
export type DocMedia = "photo" | "pdf_text" | "pdf_scan" | "none";

export type PipelineDeps = {
  fallbackEnabled: () => Promise<boolean>;
  aiText: (missing: string[]) => Promise<Fields | null>;
  /** essential = vision indispensable (photo/scan dont la qualité métier OCR est insuffisante). */
  aiVision: (missing: string[], essential: boolean) => Promise<Fields | null>;
  logLocal: (route: "ocr_rules" | "manual", missing: string[]) => Promise<void>;
  /** Bon Renault « Détail de commande » incomplet : UNE passe vision dédiée (Gemini 3.8 Flash), hors réglage repli IA. */
  aiRenault?: () => Promise<Fields | null>;
};

export type PipelineResult = { fields: Fields; route: DocRoute; missing: string[]; aiCalls: number };

/** Texte OCR jugé exploitable pour un repli texte (sinon on passe directement à la vision). */
export const MIN_TEXT_FOR_AI = 60;
/** En dessous, la « couche texte » d'un PDF n'est pas exploitable : PDF scanné. */
export const MIN_PDF_TEXT = 200;

export function detectMedia(dataUrl: string | null | undefined, text: string | null | undefined): DocMedia {
  if (!dataUrl) return "none";
  if (dataUrl.startsWith("data:image/")) return "photo";
  if (dataUrl.startsWith("data:application/pdf")) return (text ?? "").replace(/\s/g, "").length >= MIN_PDF_TEXT ? "pdf_text" : "pdf_scan";
  return "photo";
}

/**
 * Qualité métier : avoir extrait du texte ne suffit jamais. La lecture n'est réussie que si
 * les champs essentiels du type (DOC_SPECS.required) sont trouvés et plausibles.
 * Si ce n'est pas le cas sur une photo / un scan, la vision est déclenchée (même réglage
 * « repli IA » désactivé : ce réglage ne gouverne que le repli sur texte / PDF texte),
 * et elle complète les champs fiables déjà lus sans les écraser.
 */
export async function runDocPipeline(
  input: { kind: DocKind; text?: string | null; hasImage: boolean; media?: DocMedia; ctx?: RuleContext },
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const spec = DOC_SPECS[input.kind];
  const text = input.text ?? "";
  const media: DocMedia = input.media ?? (input.hasImage ? "photo" : "none");
  const clean = (f: Fields) => (spec.sanitize ? spec.sanitize(f) : { fields: f, rejected: [] as string[] });
  const first = clean(text.trim() ? spec.rules(text, input.ctx ?? {}) : {});
  // Faible confiance (champ rempli mais incohérent) : déclenche le repli comme un champ manquant.
  const suspect = Array.isArray(first.fields["_suspect"]) ? (first.fields["_suspect"] as string[]) : [];
  let fields: Fields = { ...first.fields };
  delete fields["_suspect"];
  // Lecture suspecte (valeur parasite rejetée) = champ manquant : le repli texte / vision peut le compléter.
  // Gabarit Renault fréquent : lecture complète => 0 IA ; incomplète => une seule passe vision dédiée.
  if (fields["template"] === "renault_detail_commande") {
    if (renaultIncomplete(fields) && input.hasImage && deps.aiRenault) {
      const r = await deps.aiRenault();
      fields = mergeRenaultAi(fields, r);
      return { fields, route: "ai_vision_fallback", missing: missingFields(spec, fields), aiCalls: 1 };
    }
    if (!renaultIncomplete(fields)) {
      await deps.logLocal("ocr_rules", []);
      return { fields, route: "ocr_rules", missing: [], aiCalls: 0 };
    }
  }
  let missing = [...new Set([...missingFields(spec, fields), ...first.rejected.filter((k) => empty(at(fields, k))), ...suspect])];
  if (!missing.length) {
    await deps.logLocal("ocr_rules", missing);
    return { fields, route: "ocr_rules", missing, aiCalls: 0 };
  }
  const fallback = await deps.fallbackEnabled();
  const essentialVision = input.hasImage && (media === "photo" || media === "pdf_scan");
  if (!fallback && !essentialVision) {
    await deps.logLocal("manual", missing);
    return { fields, route: "manual", missing, aiCalls: 0 };
  }
  let aiCalls = 0;
  let route: DocRoute = "manual";
  // Repli texte : seulement si autorisé et si le texte vient d'une vraie couche texte ou d'un OCR consistant.
  if (fallback && media !== "pdf_scan" && text.trim().length >= MIN_TEXT_FOR_AI) {
    aiCalls += 1;
    const r = await deps.aiText(missing);
    if (r) {
      fields = mergeAi(fields, stripMeta(clean(r).fields), suspect);
      missing = missingFields(spec, fields);
      route = "ai_text_fallback";
      if (!missing.length) return { fields, route, missing, aiCalls };
    }
  }
  if (input.hasImage && (fallback || essentialVision)) {
    aiCalls += 1;
    const r = await deps.aiVision(missing, essentialVision && !fallback);
    if (r) {
      fields = mergeAi(fields, stripMeta(clean(r).fields), suspect);
      missing = missingFields(spec, fields);
      route = "ai_vision_fallback";
    }
  }
  if (route === "manual") await deps.logLocal("manual", missing);
  return { fields, route, missing, aiCalls };
}
