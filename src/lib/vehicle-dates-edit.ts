/** Construction du patch de correction des dates véhicule (pur, testable). */
import { ctStatus, frDay } from "./vehicle-dates";

export type CtMode = "keep" | "real" | "theoretical";
export type CtProof = "pv" | "vignette" | "declaration";

export function buildDatesPatch(i: {
  before: { first_registration: string | null; delivery_date: string | null };
  mec: string | null;
  delivery: string | null;
  ctMode: CtMode;
  ct: string | null;
  proof: CtProof | null;
  /** Recalcule le commentaire CT (lignes automatiques remplacées, texte libre conservé). */
  ctComment: ((a: { ct: string | null; theoretical: string | null }) => string) | null;
  vehicleType: string | null;
  /** Date CT réelle actuelle (si vérifiée), conservée en mode « keep ». */
  currentCt: string | null;
  today?: string;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = { ct_mode: i.ctMode };
  if ((i.mec ?? null) !== (i.before.first_registration ?? null)) { patch["first_registration"] = i.mec ?? ""; patch["first_registration_source"] = "manuel"; }
  if ((i.delivery ?? null) !== (i.before.delivery_date ?? null)) patch["delivery_date"] = i.delivery ?? "";
  if (i.ctMode === "real") { patch["ct_due_date"] = i.ct; patch["ct_proof"] = i.proof; }
  if (i.ctComment) {
    const ct = i.ctMode === "real" ? i.ct : i.ctMode === "theoretical" ? null : i.currentCt;
    const st = ctStatus({ ctDue: ct, mec: i.mec, vehicleType: i.vehicleType, today: i.today });
    const theoretical = st.kind === "theoretical" ? `${st.headline} (limite théorique ${frDay(st.date)}, non attestée).` : null;
    patch["ct_comment"] = i.ctComment({ ct, theoretical });
  }
  return patch;
}
