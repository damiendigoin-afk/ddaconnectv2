/** Module Carrosserie DDA Connect : états, badges, dossiers, timeline. */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type CaseRow = Database["public"]["Tables"]["bodyshop_cases"]["Row"];
export type CaseInsert = Database["public"]["Tables"]["bodyshop_cases"]["Insert"];
export type CaseUpdate = Database["public"]["Tables"]["bodyshop_cases"]["Update"];
export type CaseEvent = Database["public"]["Tables"]["bodyshop_events"]["Row"];
export type CaseTask = Database["public"]["Tables"]["bodyshop_tasks"]["Row"];
export type CasePart = Database["public"]["Tables"]["bodyshop_parts"]["Row"];
export type CaseDoc = Database["public"]["Tables"]["bodyshop_documents"]["Row"];
export type CaseSupplement = Database["public"]["Tables"]["bodyshop_supplements"]["Row"];
export type CaseComm = Database["public"]["Tables"]["bodyshop_communications"]["Row"];
export type CasePayment = Database["public"]["Tables"]["bodyshop_payments"]["Row"];

export const MISSION_ORIGINS = [
  { key: "darva", label: "DARVA" },
  { key: "avis_sinistre", label: "Avis de sinistre / email" },
  { key: "assurance", label: "Assurance / agrément" },
  { key: "client_direct", label: "Client direct (hors agrément)" },
  { key: "manuel", label: "Création manuelle" },
  { key: "vehicule_present", label: "Véhicule déjà présent" },
  { key: "passage_expert", label: "Passage d'un expert" },
] as const;

/** B — État du dossier (administratif). */
export const CASE_STATES = [
  { key: "mission_creee", label: "Mission créée", tone: "neutral" },
  { key: "ead_en_cours", label: "EAD en cours", tone: "info" },
  { key: "attente_expert", label: "Attente expert", tone: "warn" },
  { key: "rapport_recu", label: "Rapport reçu", tone: "info" },
  { key: "travaux_valides", label: "Travaux validés", tone: "info" },
  { key: "pieces_a_commander", label: "Pièces à commander", tone: "warn" },
  { key: "pieces_commandees", label: "Pièces commandées", tone: "info" },
  { key: "dispo_controlee", label: "Disponibilité contrôlée", tone: "info" },
  { key: "rdv_a_prendre", label: "RDV à prendre", tone: "warn" },
  { key: "rdv_prevu", label: "RDV prévu", tone: "ok" },
  { key: "attente_pieces", label: "Attente pièces", tone: "warn" },
  { key: "attente_complement", label: "Attente complément expert", tone: "warn" },
  { key: "en_cours", label: "En cours", tone: "info" },
  { key: "travaux_termines", label: "Travaux terminés", tone: "ok" },
  { key: "restitution", label: "Restitution", tone: "ok" },
  { key: "attente_paiement", label: "Attente paiement", tone: "danger" },
  { key: "dossier_clos", label: "Dossier clos", tone: "done" },
] as const;

/** A — État physique du véhicule. */
export const PHYSICAL_STATES = [
  { key: "pas_entre", label: "Pas entré" },
  { key: "present", label: "Présent" },
  { key: "demontage", label: "Démontage" },
  { key: "carrosserie", label: "Carrosserie" },
  { key: "peinture", label: "Peinture" },
  { key: "remontage", label: "Remontage" },
  { key: "controle", label: "Contrôle" },
  { key: "travaux_termines", label: "Travaux terminés" },
  { key: "restitue", label: "Restitué" },
] as const;

export const WORK_LOCATIONS = [
  { key: "site", label: "Sur site" },
  { key: "st_cyp", label: "ST CYP (sous-traitance)" },
  { key: "sous_traitance", label: "Autre sous-traitance" },
] as const;

export const PART_STATUSES = [
  { key: "prevue_rapport", label: "Prévue rapport" },
  { key: "a_commander", label: "À commander" },
  { key: "commandee", label: "Commandée" },
  { key: "recue", label: "Reçue" },
  { key: "manquante", label: "Manquante" },
  { key: "incorrecte", label: "Incorrecte" },
  { key: "supplementaire", label: "Supplémentaire" },
  { key: "utilisee", label: "Utilisée" },
  { key: "non_utilisee", label: "Non utilisée" },
  { key: "a_retourner", label: "À retourner" },
  { key: "retournee", label: "Retournée" },
] as const;

export const DOC_TYPES = [
  { key: "mission", label: "Mission" },
  { key: "avis_sinistre", label: "Avis de sinistre" },
  { key: "ead", label: "EAD" },
  { key: "rapport_expertise", label: "Rapport d'expertise" },
  { key: "devis", label: "Devis" },
  { key: "or", label: "OR" },
  { key: "accord", label: "Accord" },
  { key: "prise_en_charge", label: "Prise en charge" },
  { key: "facture", label: "Facture" },
  { key: "photo", label: "Photo" },
  { key: "justificatif", label: "Justificatif" },
  { key: "autre", label: "Autre" },
] as const;

export const PAYMENT_KINDS = [
  { key: "assurance", label: "Assurance" },
  { key: "franchise", label: "Franchise" },
  { key: "vetuste", label: "Vétusté" },
  { key: "tva", label: "TVA" },
  { key: "autre", label: "Autre" },
] as const;

export function stateLabel(key: string | null): string {
  return CASE_STATES.find((s) => s.key === key)?.label ?? key ?? "—";
}
export function physicalLabel(key: string | null): string {
  return PHYSICAL_STATES.find((s) => s.key === key)?.label ?? key ?? "—";
}
export function stateTone(key: string | null): string {
  const tone = CASE_STATES.find((s) => s.key === key)?.tone ?? "neutral";
  const map: Record<string, string> = {
    neutral: "bg-secondary text-foreground",
    info: "bg-blue-100 text-blue-900",
    warn: "bg-amber-200 text-amber-950",
    ok: "bg-emerald-200 text-emerald-950",
    danger: "bg-red-200 text-red-950",
    done: "bg-zinc-800 text-zinc-100",
  };
  return map[tone] ?? map["neutral"]!;
}

/** État financier C : reste à encaisser. */
export function financialBalance(c: CaseRow) {
  const kinds: [number | null, number | null][] = [
    [c.amount_insurer_expected, c.amount_insurer_received],
    [c.amount_franchise_expected, c.amount_franchise_received],
    [c.amount_depreciation_expected, c.amount_depreciation_received],
    [c.amount_vat_expected, c.amount_vat_received],
    [c.amount_other_expected, c.amount_other_received],
  ];
  let expected = 0;
  let received = 0;
  for (const [e, r] of kinds) {
    expected += Number(e ?? 0);
    received += Number(r ?? 0);
  }
  return { expected, received, remaining: Math.round((expected - received) * 100) / 100 };
}

/** RÈGLE : travaux terminés ≠ dossier clos. Clos seulement si tout est réglé. */
export function canClose(c: CaseRow): boolean {
  return financialBalance(c).remaining <= 0;
}

export function isLate(c: CaseRow): boolean {
  if (!c.expected_return_at || c.case_state === "dossier_clos") return false;
  return new Date(c.expected_return_at).getTime() < Date.now() && c.physical_state !== "restitue";
}

export async function logEvent(input: {
  caseId: string;
  kind: string;
  label: string;
  detail?: string | null;
  source?: string;
  byName?: string | null;
}) {
  const { data: auth } = await supabase.auth.getUser();
  await supabase.from("bodyshop_events").insert({
    case_id: input.caseId,
    kind: input.kind,
    label: input.label,
    detail: input.detail ?? null,
    source: input.source ?? "app",
    created_by: auth.user?.id ?? null,
    created_by_name: input.byName ?? auth.user?.email ?? null,
  });
}

export async function listCases(): Promise<CaseRow[]> {
  const { data, error } = await supabase
    .from("bodyshop_cases")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as CaseRow[];
}

export async function getCase(id: string): Promise<CaseRow | null> {
  const { data } = await supabase.from("bodyshop_cases").select("*").eq("id", id).maybeSingle();
  return (data as CaseRow) ?? null;
}

export async function createCase(input: CaseInsert): Promise<CaseRow> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("bodyshop_cases")
    .insert({ ...input, created_by: auth.user?.id ?? null, created_by_name: auth.user?.email ?? null })
    .select()
    .single();
  if (error) throw error;
  const row = data as CaseRow;
  await logEvent({ caseId: row.id, kind: "mission", label: "Mission créée", detail: row.mission_origin });
  return row;
}

export async function updateCase(id: string, patch: CaseUpdate, event?: { label: string; detail?: string }) {
  const { error } = await supabase.from("bodyshop_cases").update(patch).eq("id", id);
  if (error) throw error;
  if (event) await logEvent({ caseId: id, kind: "maj", label: event.label, detail: event.detail ?? null });
}

export type CaseCounters = {
  rdv_a_prendre: number;
  rdv_prevu: number;
  presents: number;
  en_cours: number;
  attente_expert: number;
  attente_pieces: number;
  complements: number;
  retards: number;
  travaux_termines: number;
  attente_paiement: number;
  vge: number;
  grele: number;
  sous_traitance: number;
};

export function computeCounters(rows: CaseRow[]): CaseCounters {
  const open = rows.filter((r) => r.case_state !== "dossier_clos");
  return {
    rdv_a_prendre: open.filter((r) => r.case_state === "rdv_a_prendre").length,
    rdv_prevu: open.filter((r) => r.case_state === "rdv_prevu").length,
    presents: open.filter((r) => r.physical_state !== "pas_entre" && r.physical_state !== "restitue").length,
    en_cours: open.filter((r) => r.case_state === "en_cours").length,
    attente_expert: open.filter((r) => r.case_state === "attente_expert").length,
    attente_pieces: open.filter((r) => r.case_state === "attente_pieces" || r.case_state === "pieces_a_commander").length,
    complements: open.filter((r) => r.case_state === "attente_complement").length,
    retards: open.filter(isLate).length,
    travaux_termines: open.filter((r) => r.physical_state === "travaux_termines" || r.case_state === "travaux_termines").length,
    attente_paiement: open.filter((r) => r.case_state === "attente_paiement").length,
    vge: open.filter((r) => r.is_vge).length,
    grele: open.filter((r) => r.is_hail).length,
    sous_traitance: open.filter((r) => r.work_location !== "site").length,
  };
}

export const COUNTER_FILTERS: { key: keyof CaseCounters; label: string; match: (r: CaseRow) => boolean }[] = [
  { key: "rdv_a_prendre", label: "RDV à prendre", match: (r) => r.case_state === "rdv_a_prendre" },
  { key: "rdv_prevu", label: "RDV prévus", match: (r) => r.case_state === "rdv_prevu" },
  { key: "presents", label: "Véhicules présents", match: (r) => r.physical_state !== "pas_entre" && r.physical_state !== "restitue" },
  { key: "en_cours", label: "En cours", match: (r) => r.case_state === "en_cours" },
  { key: "attente_expert", label: "Attente expert", match: (r) => r.case_state === "attente_expert" },
  { key: "attente_pieces", label: "Attente pièces", match: (r) => r.case_state === "attente_pieces" || r.case_state === "pieces_a_commander" },
  { key: "complements", label: "Compléments experts", match: (r) => r.case_state === "attente_complement" },
  { key: "retards", label: "Retards", match: isLate },
  { key: "travaux_termines", label: "Travaux terminés", match: (r) => r.physical_state === "travaux_termines" || r.case_state === "travaux_termines" },
  { key: "attente_paiement", label: "Attente paiement", match: (r) => r.case_state === "attente_paiement" },
  { key: "vge", label: "VGE", match: (r) => r.is_vge },
  { key: "grele", label: "Grêle", match: (r) => r.is_hail },
  { key: "sous_traitance", label: "Sous-traitance", match: (r) => r.work_location !== "site" },
];

/** Modèles de messages client (modifiables avant envoi). */
export const CLIENT_TEMPLATES = [
  { key: "rdv_confirme", label: "Confirmation RDV", subject: "Votre rendez-vous carrosserie", body: "Bonjour,\n\nNous confirmons le rendez-vous pour votre véhicule {{plate}} le {{rdv}}.\n\nCordialement," },
  { key: "rappel", label: "Rappel RDV", subject: "Rappel de votre rendez-vous", body: "Bonjour,\n\nNous vous rappelons votre rendez-vous du {{rdv}} pour le véhicule {{plate}}.\n\nCordialement," },
  { key: "vehicule_entre", label: "Véhicule entré", subject: "Votre véhicule est bien entré à l'atelier", body: "Bonjour,\n\nVotre véhicule {{plate}} est bien entré à l'atelier. Nous vous tenons informé.\n\nCordialement," },
  { key: "travaux_en_cours", label: "Travaux en cours", subject: "Travaux en cours", body: "Bonjour,\n\nLes travaux sur votre véhicule {{plate}} sont en cours.\n\nCordialement," },
  { key: "attente_piece", label: "Attente pièce", subject: "Attente d'une pièce", body: "Bonjour,\n\nNous sommes en attente d'une pièce pour votre véhicule {{plate}}. Nous revenons vers vous dès réception.\n\nCordialement," },
  { key: "attente_expert", label: "Attente expert", subject: "Attente de l'accord de l'expert", body: "Bonjour,\n\nNous attendons l'accord de l'expert pour votre véhicule {{plate}}.\n\nCordialement," },
  { key: "retard", label: "Retard", subject: "Information sur le délai", body: "Bonjour,\n\nLa restitution de votre véhicule {{plate}} connaît un léger retard. Nous revenons vers vous rapidement.\n\nCordialement," },
  { key: "nouvelle_date", label: "Nouvelle date", subject: "Nouvelle date de restitution", body: "Bonjour,\n\nLa nouvelle date de restitution prévue pour votre véhicule {{plate}} est le {{restitution}}.\n\nCordialement," },
  { key: "travaux_termines", label: "Travaux terminés", subject: "Travaux terminés", body: "Bonjour,\n\nLes travaux sur votre véhicule {{plate}} sont terminés.\n\nCordialement," },
  { key: "vehicule_pret", label: "Véhicule prêt", subject: "Votre véhicule est prêt", body: "Bonjour,\n\nVotre véhicule {{plate}} est prêt et disponible à la restitution.\n\nCordialement," },
] as const;

export function fillTemplate(text: string, c: CaseRow): string {
  return text
    .replaceAll("{{plate}}", c.plate ?? "")
    .replaceAll("{{rdv}}", c.appointment_at ? new Date(c.appointment_at).toLocaleString("fr-FR") : "—")
    .replaceAll("{{restitution}}", c.expected_return_at ? new Date(c.expected_return_at).toLocaleDateString("fr-FR") : "—");
}
