/**
 * Module Magasin — Retours fournisseurs, consignes, avoirs et litiges.
 *
 * Modèle : un dossier de retour (part_returns) porte des lignes
 * (part_return_lines), une chronologie (return_events), des documents
 * (return_documents) et des avoirs (credit_notes / credit_note_lines).
 * Tout est horodaté et rattaché au fournisseur, au véhicule et à l'établissement.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type PartReturn = Database["public"]["Tables"]["part_returns"]["Row"];
export type ReturnLine = Database["public"]["Tables"]["part_return_lines"]["Row"];
export type ReturnEvent = Database["public"]["Tables"]["return_events"]["Row"];
export type ReturnDocument = Database["public"]["Tables"]["return_documents"]["Row"];
export type CreditNote = Database["public"]["Tables"]["credit_notes"]["Row"];
export type CreditNoteLine = Database["public"]["Tables"]["credit_note_lines"]["Row"];

export type ReturnWithLines = PartReturn & { lines: ReturnLine[] };

/* ------------------------------------------------------------------ */
/* Référentiels                                                        */
/* ------------------------------------------------------------------ */

/** Workflow principal (1 → 14) + branches. */
export const RETURN_STATUSES = [
  { key: "brouillon", label: "Brouillon", step: 0, tone: "bg-zinc-200 text-zinc-700" },
  { key: "a_preparer", label: "Retour à préparer", step: 1, tone: "bg-amber-200 text-amber-950" },
  { key: "lignes_a_confirmer", label: "Lignes à confirmer", step: 2, tone: "bg-amber-100 text-amber-900" },
  { key: "prepare", label: "Retour préparé", step: 3, tone: "bg-blue-100 text-blue-900" },
  { key: "accord_demande", label: "Accord demandé", step: 4, tone: "bg-blue-100 text-blue-900" },
  { key: "accord_attendu", label: "Accord fournisseur attendu", step: 5, tone: "bg-blue-100 text-blue-900" },
  { key: "accord_accepte", label: "Retour accepté", step: 6, tone: "bg-emerald-100 text-emerald-900" },
  { key: "a_expedier", label: "En attente d'expédition", step: 7, tone: "bg-amber-200 text-amber-950" },
  { key: "expedie", label: "Retour expédié / remis", step: 8, tone: "bg-blue-200 text-blue-950" },
  { key: "reception_a_confirmer", label: "Réception à confirmer", step: 9, tone: "bg-blue-200 text-blue-950" },
  { key: "reception_confirmee", label: "Réception confirmée", step: 10, tone: "bg-emerald-100 text-emerald-900" },
  { key: "avoir_attendu", label: "Avoir attendu", step: 11, tone: "bg-amber-200 text-amber-950" },
  { key: "partiellement_avoire", label: "Partiellement avoiré", step: 11, tone: "bg-orange-200 text-orange-950" },
  { key: "totalement_avoire", label: "Avoir reçu", step: 12, tone: "bg-emerald-200 text-emerald-950" },
  { key: "controle_financier", label: "Contrôle financier effectué", step: 13, tone: "bg-emerald-200 text-emerald-950" },
  { key: "cloture", label: "Dossier traité", step: 14, tone: "bg-zinc-800 text-zinc-100" },
  // Branches
  { key: "refus", label: "Retour refusé", step: -1, tone: "bg-red-200 text-red-950" },
  { key: "info_requise", label: "Besoin d'informations", step: -1, tone: "bg-amber-300 text-amber-950" },
  { key: "non_concerne", label: "Non concerné", step: -1, tone: "bg-zinc-200 text-zinc-700" },
  { key: "non_recu", label: "Retour non reçu", step: -1, tone: "bg-red-200 text-red-950" },
  { key: "reception_partielle", label: "Réception partielle", step: -1, tone: "bg-orange-200 text-orange-950" },
  { key: "litige", label: "Litige", step: -1, tone: "bg-red-300 text-red-950" },
  { key: "escalade", label: "Intervention responsable", step: -1, tone: "bg-red-300 text-red-950" },
  { key: "blocage_fournisseur", label: "Blocage fournisseur", step: -1, tone: "bg-red-200 text-red-950" },
  { key: "demande_creee", label: "Demande créée", step: 1, tone: "bg-secondary text-foreground" },
  { key: "annule", label: "Annulé", step: -1, tone: "bg-zinc-200 text-zinc-700" },
] as const;

export const RETURN_TYPES = [
  { key: "classique", label: "Retour classique" },
  { key: "consigne", label: "Retour de consigne" },
  { key: "endommagee", label: "Pièce endommagée" },
  { key: "refus_livraison", label: "Refus à la livraison" },
  { key: "litige", label: "Litige" },
] as const;

export const RETURN_REASONS = [
  { key: "erreur_reference", label: "Erreur de référence" },
  { key: "piece_non_utilisee", label: "Pièce non utilisée" },
  { key: "piece_endommagee", label: "Pièce endommagée" },
  { key: "erreur_commande", label: "Erreur de commande" },
  { key: "consigne", label: "Consigne / échange standard" },
  { key: "surplus", label: "Commande en surplus" },
  { key: "non_conforme", label: "Pièce non conforme" },
  { key: "autre", label: "Autre" },
] as const;

export const HANDOVER_MODES = [
  { key: "transporteur", label: "Transporteur" },
  { key: "commercial", label: "Commercial fournisseur" },
  { key: "livreur", label: "Livreur fournisseur" },
  { key: "remise_directe", label: "Remise directe" },
  { key: "autre", label: "Autre" },
] as const;

export const SUPPLIER_ANSWERS = [
  { key: "accepte", label: "Retour accepté" },
  { key: "refuse", label: "Retour refusé" },
  { key: "info", label: "Besoin d'informations" },
  { key: "non_concerne", label: "Non concerné" },
  { key: "en_cours", label: "En cours d'étude" },
] as const;

export const RECEPTION_ANSWERS = [
  { key: "recu", label: "Bien reçu" },
  { key: "non_recu", label: "Non reçu" },
  { key: "partiel", label: "Réception partielle" },
  { key: "probleme", label: "Problème sur le retour" },
  { key: "non_concerne", label: "Non concerné" },
] as const;

export const CLOSURE_REASONS = [
  { key: "avoir_recu", label: "Avoir reçu et rapproché" },
  { key: "abandon", label: "Abandon du retour" },
  { key: "refus_definitif", label: "Refus définitif du fournisseur" },
  { key: "perte", label: "Pièce perdue / non retrouvée" },
  { key: "geste_commercial", label: "Geste commercial" },
  { key: "autre", label: "Autre (préciser)" },
] as const;

export const DOCUMENT_KINDS = [
  { key: "bl", label: "Bon de livraison" },
  { key: "facture", label: "Facture" },
  { key: "photo_piece", label: "Photo pièce" },
  { key: "photo_colis", label: "Photo colis" },
  { key: "preuve_remise", label: "Preuve de remise" },
  { key: "bon_transport", label: "Bon de transport" },
  { key: "avoir", label: "Avoir" },
  { key: "bl_negatif", label: "BL négatif" },
  { key: "annulation_facture", label: "Annulation de facture" },
  { key: "accord_retour", label: "Accord de retour" },
  { key: "reponse_fournisseur", label: "Réponse fournisseur" },
  { key: "autre", label: "Autre document" },
] as const;

const OPEN_EXCLUDED = ["cloture", "annule", "non_concerne"];
const DISPUTE = ["litige", "refus", "escalade", "blocage_fournisseur", "non_recu"];

export function returnStatusLabel(k: string) {
  return RETURN_STATUSES.find((s) => s.key === k)?.label ?? k;
}
export function returnStatusTone(k: string) {
  return RETURN_STATUSES.find((s) => s.key === k)?.tone ?? "bg-secondary text-foreground";
}
export function returnStatusStep(k: string) {
  return RETURN_STATUSES.find((s) => s.key === k)?.step ?? -1;
}
export function returnTypeLabel(k: string | null) {
  return RETURN_TYPES.find((t) => t.key === k)?.label ?? "Retour classique";
}
export function reasonLabel(k: string | null) {
  return RETURN_REASONS.find((r) => r.key === k)?.label ?? k ?? "—";
}
export function handoverLabel(k: string | null) {
  return HANDOVER_MODES.find((m) => m.key === k)?.label ?? k ?? "—";
}
export function documentKindLabel(k: string | null) {
  return DOCUMENT_KINDS.find((d) => d.key === k)?.label ?? "Document";
}

export function isDraft(r: Pick<PartReturn, "status">): boolean {
  return r.status === "brouillon";
}
export function isOpen(r: Pick<PartReturn, "status">): boolean {
  return !OPEN_EXCLUDED.includes(r.status);
}
export function isDispute(r: Pick<PartReturn, "status">): boolean {
  return DISPUTE.includes(r.status);
}
export function isConsigne(r: ReturnWithLines): boolean {
  return r.return_type === "consigne" || r.lines.some((l) => l.item_type === "consigne");
}

export function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function ageBucket(iso: string): "0-15" | "16-30" | "31-45" | "45+" {
  const days = ageDays(iso);
  if (days <= 15) return "0-15";
  if (days <= 30) return "16-30";
  if (days <= 45) return "31-45";
  return "45+";
}

export function deadlineFrom(maxDays: number | null | undefined): string | null {
  if (!maxDays) return null;
  const d = new Date();
  d.setDate(d.getDate() + maxDays);
  return d.toISOString().slice(0, 10);
}

export function isUrgent(r: PartReturn): boolean {
  if (!r.deadline_date) return false;
  if (!isOpen(r)) return false;
  const days = (new Date(r.deadline_date).getTime() - Date.now()) / 86400000;
  return days <= 7;
}

/** Montant d'avoir encore attendu sur un dossier (avoirs + consignes). */
export function pendingAmount(r: PartReturn): number {
  const expected = Number(r.expected_amount ?? 0) + Number(r.deposit_amount ?? 0);
  return Math.max(0, expected - Number(r.credited_amount ?? 0));
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

export async function listReturns(): Promise<ReturnWithLines[]> {
  const { data, error } = await supabase
    .from("part_returns")
    .select("*, lines:part_return_lines(*)")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as ReturnWithLines[];
}

export async function getReturn(id: string): Promise<ReturnWithLines | null> {
  const { data } = await supabase
    .from("part_returns")
    .select("*, lines:part_return_lines(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as ReturnWithLines) ?? null;
}

export async function listReturnsForVehicle(opts: { plate?: string | null; refVehicleId?: string | null }) {
  let q = supabase.from("part_returns").select("*, lines:part_return_lines(*)").order("created_at", { ascending: false });
  if (opts.refVehicleId) q = q.eq("ref_vehicle_id", opts.refVehicleId);
  else if (opts.plate) q = q.eq("plate", opts.plate);
  else return [];
  const { data } = await q;
  return (data ?? []) as ReturnWithLines[];
}

export async function listEvents(returnId: string): Promise<ReturnEvent[]> {
  const { data } = await supabase
    .from("return_events")
    .select("*")
    .eq("return_id", returnId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ReturnEvent[];
}

export async function listDocuments(returnId: string): Promise<ReturnDocument[]> {
  const { data } = await supabase
    .from("return_documents")
    .select("*")
    .eq("return_id", returnId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ReturnDocument[];
}

/** Journalise un événement dans la chronologie du dossier. */
export async function logEvent(
  returnId: string,
  kind: string,
  detail: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("return_events").insert({
    return_id: returnId,
    kind,
    detail,
    payload: (payload as never) ?? null,
    actor_id: auth.user?.id ?? null,
    actor_name: auth.user?.email ?? null,
  });
}

export async function addDocument(
  returnId: string,
  doc: { kind: string; storagePath: string; filename?: string; mimeType?: string; source?: string },
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("return_documents").insert({
    return_id: returnId,
    kind: doc.kind,
    storage_path: doc.storagePath,
    filename: doc.filename ?? null,
    mime_type: doc.mimeType ?? null,
    source: doc.source ?? "interne",
    uploaded_by: auth.user?.id ?? null,
    uploaded_by_name: auth.user?.email ?? null,
  });
  await logEvent(returnId, "document", `${documentKindLabel(doc.kind)} ajouté`, { path: doc.storagePath });
}

/* ------------------------------------------------------------------ */
/* Avoirs                                                              */
/* ------------------------------------------------------------------ */

/** Recalcule le statut d'avoir d'un retour à partir de ses lignes. */
export async function refreshReturnCredit(id: string) {
  const r = await getReturn(id);
  if (!r) return;
  const totalQty = r.lines.reduce((s, l) => s + Number(l.quantity ?? 0), 0);
  const creditedQty = r.lines.reduce((s, l) => s + Number(l.credited_quantity ?? 0), 0);
  const creditedAmount = r.lines.reduce((s, l) => s + Number(l.credited_amount ?? 0), 0);
  let status = r.status;
  if (creditedQty <= 0) status = returnStatusStep(r.status) >= 8 ? "avoir_attendu" : r.status;
  else if (creditedQty < totalQty) status = "partiellement_avoire";
  else status = "totalement_avoire";
  await supabase.from("part_returns").update({ status, credited_amount: creditedAmount }).eq("id", id);
  const expected = Number(r.expected_amount ?? 0) + Number(r.deposit_amount ?? 0);
  const gap = Math.round((expected - creditedAmount) * 100) / 100;
  if (creditedQty > 0) {
    await logEvent(id, "avoir", `Avoir enregistré : ${creditedAmount.toFixed(2)} €${gap > 0.01 ? ` (écart ${gap.toFixed(2)} €)` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* Tableau de bord                                                     */
/* ------------------------------------------------------------------ */

export type ReturnCounters = {
  a_preparer: number;
  accord_attendu: number;
  acceptes_non_expedies: number;
  expedies: number;
  reception_a_confirmer: number;
  avoirs_attendus: number;
  consignes_a_retourner: number;
  consignes_avoir_attendu: number;
  litiges: number;
  relances: number;
  reponses_recentes: number;
  urgences: number;
  clotures: number;
  montant_attendu: number;
  montant_consignes: number;
};

export const COUNTER_LABELS: { key: keyof ReturnCounters; label: string; money?: boolean }[] = [
  { key: "a_preparer", label: "À préparer" },
  { key: "accord_attendu", label: "Accord attendu" },
  { key: "acceptes_non_expedies", label: "Acceptés non expédiés" },
  { key: "expedies", label: "Expédiés" },
  { key: "reception_a_confirmer", label: "Réception à confirmer" },
  { key: "avoirs_attendus", label: "Avoirs attendus" },
  { key: "consignes_a_retourner", label: "Consignes à retourner" },
  { key: "consignes_avoir_attendu", label: "Consignes / avoir" },
  { key: "litiges", label: "Litiges" },
  { key: "relances", label: "Relances à faire" },
  { key: "reponses_recentes", label: "Réponses récentes" },
  { key: "urgences", label: "Urgences délai" },
  { key: "clotures", label: "Dossiers traités" },
  { key: "montant_attendu", label: "Avoirs attendus (€)", money: true },
  { key: "montant_consignes", label: "Consignes en attente (€)", money: true },
];

/** Une relance est due si le dossier attend une réponse depuis plus de 7 jours. */
export function needsReminder(r: PartReturn, firstDays = 7, intervalDays = 7, maxReminders = 3): boolean {
  if (!isOpen(r)) return false;
  const waiting = ["accord_demande", "accord_attendu", "expedie", "reception_a_confirmer", "avoir_attendu", "partiellement_avoire"];
  if (!waiting.includes(r.status)) return false;
  if ((r.reminder_count ?? 0) >= maxReminders) return false;
  const base = r.last_reminder_at ?? r.accord_requested_at ?? r.handover_at ?? r.shipped_at ?? r.updated_at;
  const days = ageDays(base);
  return days >= (r.last_reminder_at ? intervalDays : firstDays);
}

export function computeReturnCounters(rows: ReturnWithLines[]): ReturnCounters {
  const open = rows.filter(isOpen);
  const consignes = open.filter(isConsigne);
  const recent = Date.now() - 7 * 86400000;
  return {
    a_preparer: open.filter((r) => ["a_preparer", "demande_creee", "lignes_a_confirmer"].includes(r.status)).length,
    accord_attendu: open.filter((r) => ["accord_demande", "accord_attendu", "info_requise"].includes(r.status)).length,
    acceptes_non_expedies: open.filter((r) => ["accord_accepte", "a_expedier", "prepare"].includes(r.status)).length,
    expedies: open.filter((r) => r.status === "expedie").length,
    reception_a_confirmer: open.filter((r) => r.status === "reception_a_confirmer").length,
    avoirs_attendus: open.filter((r) => ["avoir_attendu", "partiellement_avoire", "reception_confirmee"].includes(r.status)).length,
    consignes_a_retourner: consignes.filter((r) => returnStatusStep(r.status) > 0 && returnStatusStep(r.status) < 8).length,
    consignes_avoir_attendu: consignes.filter((r) => ["avoir_attendu", "partiellement_avoire", "reception_confirmee"].includes(r.status)).length,
    litiges: open.filter(isDispute).length,
    relances: open.filter((r) => needsReminder(r)).length,
    reponses_recentes: rows.filter((r) => r.accord_response_at && new Date(r.accord_response_at).getTime() > recent).length,
    urgences: open.filter(isUrgent).length,
    clotures: rows.filter((r) => r.status === "cloture").length,
    montant_attendu: round2(open.reduce((s, r) => s + pendingAmount(r), 0)),
    montant_consignes: round2(consignes.reduce((s, r) => s + Math.max(0, Number(r.deposit_amount ?? 0) - Number(r.credited_amount ?? 0)), 0)),
  };
}

/** Filtre la liste selon un indicateur du tableau de bord. */
export function filterByCounter(rows: ReturnWithLines[], key: string): ReturnWithLines[] {
  const open = rows.filter(isOpen);
  switch (key) {
    case "a_preparer": return open.filter((r) => ["a_preparer", "demande_creee", "lignes_a_confirmer"].includes(r.status));
    case "accord_attendu": return open.filter((r) => ["accord_demande", "accord_attendu", "info_requise"].includes(r.status));
    case "acceptes_non_expedies": return open.filter((r) => ["accord_accepte", "a_expedier", "prepare"].includes(r.status));
    case "expedies": return open.filter((r) => r.status === "expedie");
    case "reception_a_confirmer": return open.filter((r) => r.status === "reception_a_confirmer");
    case "avoirs_attendus": return open.filter((r) => ["avoir_attendu", "partiellement_avoire", "reception_confirmee"].includes(r.status));
    case "consignes_a_retourner": return open.filter((r) => isConsigne(r) && returnStatusStep(r.status) > 0 && returnStatusStep(r.status) < 8);
    case "consignes_avoir_attendu": return open.filter((r) => isConsigne(r) && ["avoir_attendu", "partiellement_avoire", "reception_confirmee"].includes(r.status));
    case "litiges": return open.filter(isDispute);
    case "relances": return open.filter((r) => needsReminder(r));
    case "reponses_recentes": return rows.filter((r) => r.accord_response_at && Date.now() - new Date(r.accord_response_at).getTime() < 7 * 86400000);
    case "urgences": return open.filter(isUrgent);
    case "clotures": return rows.filter((r) => r.status === "cloture");
    case "montant_attendu": return open.filter((r) => pendingAmount(r) > 0);
    case "montant_consignes": return open.filter((r) => isConsigne(r) && pendingAmount(r) > 0);
    default: return rows;
  }
}

/* ------------------------------------------------------------------ */
/* Vue fournisseur                                                     */
/* ------------------------------------------------------------------ */

export type SupplierSummary = {
  supplierId: string | null;
  open: number;
  pendingAmount: number;
  depositPending: number;
  oldestDays: number;
  reminders: number;
  disputes: number;
};

export function supplierSummaries(rows: ReturnWithLines[]): SupplierSummary[] {
  const map = new Map<string, SupplierSummary>();
  for (const r of rows.filter(isOpen)) {
    const key = r.supplier_id ?? "—";
    const cur = map.get(key) ?? {
      supplierId: r.supplier_id,
      open: 0,
      pendingAmount: 0,
      depositPending: 0,
      oldestDays: 0,
      reminders: 0,
      disputes: 0,
    };
    cur.open += 1;
    cur.pendingAmount += pendingAmount(r);
    if (isConsigne(r)) cur.depositPending += Math.max(0, Number(r.deposit_amount ?? 0) - Number(r.credited_amount ?? 0));
    cur.oldestDays = Math.max(cur.oldestDays, ageDays(r.created_at));
    if (needsReminder(r)) cur.reminders += 1;
    if (isDispute(r)) cur.disputes += 1;
    map.set(key, cur);
  }
  return [...map.values()]
    .map((s) => ({ ...s, pendingAmount: round2(s.pendingAmount), depositPending: round2(s.depositPending) }))
    .sort((a, b) => b.pendingAmount - a.pendingAmount || b.open - a.open);
}

/* ------------------------------------------------------------------ */
/* Recherche globale tolérante                                         */
/* ------------------------------------------------------------------ */

function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchHaystack(r: ReturnWithLines, supplierName?: string | null): string {
  return norm(
    [
      r.reference,
      supplierName,
      r.bl_number,
      r.invoice_number,
      r.or_number,
      r.plate,
      r.comments,
      r.reason,
      r.carrier,
      r.tracking_number,
      r.handover_person,
      r.handover_company,
      r.handover_place,
      r.accord_comment,
      r.reception_comment,
      r.closure_comment,
      returnStatusLabel(r.status),
      returnTypeLabel(r.return_type),
      r.expected_amount,
      r.deposit_amount,
      r.credited_amount,
      ...r.lines.flatMap((l) => [l.reference, l.label, l.notes]),
    ].join(" "),
  );
}

/** Recherche tolérante : tous les mots doivent apparaître, accents/ponctuation ignorés. */
export function searchReturns(
  rows: ReturnWithLines[],
  query: string,
  supplierName: (id: string | null) => string | null,
): ReturnWithLines[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = searchHaystack(r, supplierName(r.supplier_id));
    return words.every((w) => hay.includes(w));
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
