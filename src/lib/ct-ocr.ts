/**
 * Contrôle technique : provenance de la lecture automatique et décision d'enregistrement.
 * Pur et testable. La réponse du modèle n'est qu'une PROPOSITION, jamais une preuve.
 */
import { firstValidCtDate } from "./ct";

export const CT_SOURCE_OCR_CONFIRMED = "ocr_confirme";
export const CT_SOURCE_CORRECTED = "date_corrigee";
export const CT_SOURCE_EXISTING_CONFIRMED = "preexistante_confirmee";

export const isPhotoDataUrl = (dataUrl: string) => /^data:image\//i.test(dataUrl);

export type CtProvenance = {
  path: "vision_photo" | "regles_texte" | "ia_texte" | "echec";
  route: string | null;
  vision_first: boolean;
  ai_calls: number;
  has_ct_date: boolean;
  confidence: number | null;
};

export function ctProvenance(r: { ok: boolean; route?: string | null; visionFirst?: boolean; visionFailed?: boolean; aiCalls?: number; parsed?: Record<string, unknown> | null }): CtProvenance {
  const route = r.route ?? null;
  const hasDate = Boolean(firstValidCtDate(typeof r.parsed?.["ct_due_date"] === "string" ? (r.parsed["ct_due_date"] as string) : null));
  const c = Number(r.parsed?.["confidence"]);
  const path: CtProvenance["path"] = !r.ok || r.visionFailed || !hasDate ? "echec"
    : route === "ai_vision_fallback" ? "vision_photo"
    : route === "ai_text_fallback" ? "ia_texte" : "regles_texte";
  return { path, route, vision_first: Boolean(r.visionFirst), ai_calls: r.aiCalls ?? 0, has_ct_date: hasDate, confidence: Number.isFinite(c) ? c : null };
}

/** Source exacte à enregistrer selon la date finale, la date proposée et la date déjà connue. */
export function ctSaveSource(i: { finalCt: string; ocrCt?: string | null; existingCt?: string | null }): string {
  const ocr = firstValidCtDate(i.ocrCt);
  if (ocr && i.finalCt === ocr) return CT_SOURCE_OCR_CONFIRMED;
  const existing = firstValidCtDate(i.existingCt);
  if (!ocr && existing && i.finalCt === existing) return CT_SOURCE_EXISTING_CONFIRMED;
  return CT_SOURCE_CORRECTED;
}

/** Même jour et même mois qu'aujourd'hui : piège possible du calendrier prérempli à la date du jour. */
export function sameDayMonthAsToday(iso: string, today = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  return Number(m[2]) === today.getMonth() + 1 && Number(m[3]) === today.getDate();
}

export type CtSaveCheck = { ok: true; warnings: string[] } | { ok: false; error: string };

/**
 * Contrôle avant « Enregistrer cette date » : date complète obligatoire ; date différente
 * de la proposition ou au jour/mois d'aujourd'hui = avertissement à confirmer explicitement.
 */
export function checkCtSave(i: { finalCt: string; ocrCt?: string | null; today?: Date }): CtSaveCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.finalCt) || !firstValidCtDate(i.finalCt)) return { ok: false, error: "Date incomplète : choisissez jour, mois et année." };
  const warnings: string[] = [];
  const ocr = firstValidCtDate(i.ocrCt);
  const fr = (d: string) => d.split("-").reverse().join("/");
  if (ocr && ocr !== i.finalCt) warnings.push(`Cette date (${fr(i.finalCt)}) diffère de la date lue sur la photo (${fr(ocr)}).`);
  if (sameDayMonthAsToday(i.finalCt, i.today)) warnings.push(`Le jour et le mois (${fr(i.finalCt).slice(0, 5)}) sont ceux d’aujourd’hui : le calendrier a peut-être proposé la date du jour. Vérifiez sur le CT.`);
  return { ok: true, warnings };
}
