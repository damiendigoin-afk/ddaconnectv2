/**
 * Pipeline commun de lecture photo/PDF (règle globale DDA Connect) — orchestration pure, testable.
 *  1. texte OCR local / natif PDF (0 crédit) -> règles déterministes ;
 *  2. champs indispensables trouvés => AUCUN appel IA (voie `ocr_rules`) ;
 *  3. sinon, si le repli IA est autorisé : IA sur le TEXTE seul (`ai_text_fallback`) ;
 *  4. vision sur l'image seulement si le texte reste insuffisant (`ai_vision_fallback`).
 */
import { DOC_SPECS, fillMissing, missingFields, type DocKind, type Fields, type RuleContext } from "./doc-rules";

export type DocRoute = "ocr_rules" | "ai_text_fallback" | "ai_vision_fallback" | "manual";

export type PipelineDeps = {
  fallbackEnabled: () => Promise<boolean>;
  aiText: (missing: string[]) => Promise<Fields | null>;
  aiVision: (missing: string[]) => Promise<Fields | null>;
  logLocal: (route: "ocr_rules" | "manual", missing: string[]) => Promise<void>;
};

export type PipelineResult = { fields: Fields; route: DocRoute; missing: string[]; aiCalls: number };

/** Texte OCR jugé exploitable pour un repli texte (sinon on passe directement à la vision). */
export const MIN_TEXT_FOR_AI = 60;

export async function runDocPipeline(
  input: { kind: DocKind; text?: string | null; hasImage: boolean; ctx?: RuleContext },
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const spec = DOC_SPECS[input.kind];
  const text = input.text ?? "";
  let fields = text.trim() ? spec.rules(text, input.ctx ?? {}) : {};
  let missing = missingFields(spec, fields);
  if (!missing.length) {
    await deps.logLocal("ocr_rules", missing);
    return { fields, route: "ocr_rules", missing, aiCalls: 0 };
  }
  if (!(await deps.fallbackEnabled())) {
    await deps.logLocal("manual", missing);
    return { fields, route: "manual", missing, aiCalls: 0 };
  }
  let aiCalls = 0;
  let route: DocRoute = "manual";
  if (text.trim().length >= MIN_TEXT_FOR_AI) {
    aiCalls += 1;
    const r = await deps.aiText(missing);
    if (r) {
      fields = fillMissing(fields, r);
      missing = missingFields(spec, fields);
      route = "ai_text_fallback";
      if (!missing.length) return { fields, route, missing, aiCalls };
    }
  }
  if (input.hasImage) {
    aiCalls += 1;
    const r = await deps.aiVision(missing);
    if (r) {
      fields = fillMissing(fields, r);
      missing = missingFields(spec, fields);
      route = "ai_vision_fallback";
    }
  }
  return { fields, route, missing, aiCalls };
}
