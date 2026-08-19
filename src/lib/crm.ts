import { supabase } from "@/integrations/supabase/client";

export type CrmRequest = {
  id: string;
  site_id: string | null;
  channel: string;
  subject: string;
  body: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  plate: string | null;
  priority: string;
  status: string;
  outcome: string | null;
  outcome_note: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  escalation_level: number;
  due_at: string | null;
  last_action_at: string;
  closed_at: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type CrmEvent = {
  id: string;
  request_id: string;
  kind: string;
  message: string | null;
  actor_name: string | null;
  created_at: string;
};

export const CRM_CHANNELS = [
  { key: "telephone", label: "Téléphone" },
  { key: "email", label: "Email" },
  { key: "comptoir", label: "Comptoir" },
  { key: "site_web", label: "Site web" },
  { key: "reseaux", label: "Réseaux sociaux" },
  { key: "autre", label: "Autre" },
] as const;

export const CRM_PRIORITIES = [
  { key: "basse", label: "Basse" },
  { key: "normale", label: "Normale" },
  { key: "haute", label: "Haute" },
  { key: "urgente", label: "Urgente" },
] as const;

export const CRM_STATUSES = [
  { key: "nouvelle", label: "Nouvelle" },
  { key: "en_cours", label: "En cours" },
  { key: "attente_client", label: "Attente client" },
  { key: "escaladee", label: "Escaladée" },
  { key: "cloturee", label: "Clôturée" },
] as const;

/** Issue enregistrée à la clôture — obligatoire pour fermer une demande. */
export const CRM_OUTCOMES = [
  { key: "rdv_pris", label: "RDV pris" },
  { key: "devis_envoye", label: "Devis envoyé" },
  { key: "resolu", label: "Résolu au téléphone" },
  { key: "or_cree", label: "OR créé" },
  { key: "sans_suite", label: "Sans suite" },
  { key: "perdu", label: "Client perdu" },
] as const;

/** Délai de réponse attendu (heures) selon la priorité. */
export const SLA_HOURS: Record<string, number> = {
  urgente: 2,
  haute: 8,
  normale: 24,
  basse: 72,
};

export const ESCALATION_LABELS = ["Responsable", "Relance responsable", "Collègues", "Manager"];

export function statusTone(status: string) {
  if (status === "cloturee") return "bg-secondary text-muted-foreground";
  if (status === "escaladee") return "bg-status-watch-soft text-status-watch";
  if (status === "en_cours") return "bg-brand/10 text-brand";
  return "bg-secondary text-foreground";
}

export function isOverdue(r: CrmRequest) {
  return r.status !== "cloturee" && !!r.due_at && new Date(r.due_at).getTime() < Date.now();
}

export function dueFromPriority(priority: string, from = new Date()) {
  const hours = SLA_HOURS[priority] ?? 24;
  return new Date(from.getTime() + hours * 3600_000).toISOString();
}

const SELECT =
  "id, site_id, channel, subject, body, customer_name, customer_phone, customer_email, plate, priority, status, outcome, outcome_note, assignee_id, assignee_name, escalation_level, due_at, last_action_at, closed_at, created_by_name, created_at";

export async function listRequests(scope: "open" | "mine" | "all", userId: string | null): Promise<CrmRequest[]> {
  let q = supabase.from("crm_requests").select(SELECT).order("created_at", { ascending: false }).limit(300);
  if (scope === "open") q = q.neq("status", "cloturee");
  if (scope === "mine" && userId) q = q.eq("assignee_id", userId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CrmRequest[];
}

export async function listEvents(requestId: string): Promise<CrmEvent[]> {
  const { data, error } = await supabase
    .from("crm_request_events")
    .select("id, request_id, kind, message, actor_name, created_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CrmEvent[];
}

export async function logEvent(requestId: string, kind: string, message: string, actor?: { id?: string | null; name?: string | null }) {
  await supabase.from("crm_request_events").insert({
    request_id: requestId,
    kind,
    message,
    actor_id: actor?.id ?? null,
    actor_name: actor?.name ?? null,
  } as never);
}

export async function createRequest(
  input: Partial<CrmRequest>,
  actor: { id?: string | null; name?: string | null },
): Promise<string> {
  const priority = input.priority ?? "normale";
  const { data, error } = await supabase
    .from("crm_requests")
    .insert({
      ...input,
      priority,
      status: input.status ?? "nouvelle",
      due_at: input.due_at ?? dueFromPriority(priority),
      last_action_at: new Date().toISOString(),
      created_by: actor.id ?? null,
      created_by_name: actor.name ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await logEvent(id, "creation", `Demande créée (${input.channel ?? "telephone"})`, actor);
  return id;
}

export async function assignRequest(
  id: string,
  assignee: { id: string; name: string },
  actor: { id?: string | null; name?: string | null },
) {
  const { error } = await supabase
    .from("crm_requests")
    .update({
      assignee_id: assignee.id,
      assignee_name: assignee.name,
      status: "en_cours",
      escalation_level: 0,
      last_action_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
  if (error) throw error;
  await logEvent(id, "assignation", `Assignée à ${assignee.name}`, actor);
}

export async function addNote(id: string, message: string, actor: { id?: string | null; name?: string | null }) {
  const { error } = await supabase
    .from("crm_requests")
    .update({ last_action_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
  await logEvent(id, "note", message, actor);
}

export async function setStatus(id: string, status: string, actor: { id?: string | null; name?: string | null }) {
  const { error } = await supabase
    .from("crm_requests")
    .update({ status, last_action_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
  await logEvent(id, "statut", `Statut : ${CRM_STATUSES.find((s) => s.key === status)?.label ?? status}`, actor);
}

export async function closeRequest(
  id: string,
  outcome: string,
  note: string,
  actor: { id?: string | null; name?: string | null },
) {
  if (!outcome) throw new Error("Sélectionnez l'issue de la demande avant de la clôturer.");
  const { error } = await supabase
    .from("crm_requests")
    .update({
      status: "cloturee",
      outcome,
      outcome_note: note || null,
      closed_at: new Date().toISOString(),
      last_action_at: new Date().toISOString(),
    } as never)
    .eq("id", id);
  if (error) throw error;
  await logEvent(id, "cloture", `Clôturée — ${CRM_OUTCOMES.find((o) => o.key === outcome)?.label ?? outcome}${note ? ` · ${note}` : ""}`, actor);
}

export async function deleteRequest(id: string) {
  const { error } = await supabase.from("crm_requests").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Escalade automatique des demandes en retard :
 * niveau 1 = relance du responsable, 2 = ouverture aux collègues, 3 = alerte manager.
 * Chaque palier ajoute un délai SLA supplémentaire.
 */
export async function escalateStale(): Promise<number> {
  const { data, error } = await supabase
    .from("crm_requests")
    .select(SELECT)
    .neq("status", "cloturee")
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as CrmRequest[];
  const now = Date.now();
  let escalated = 0;
  for (const r of rows) {
    if (!r.due_at || new Date(r.due_at).getTime() > now) continue;
    if (r.escalation_level >= 3) continue;
    const level = r.escalation_level + 1;
    const { error: upErr } = await supabase
      .from("crm_requests")
      .update({
        escalation_level: level,
        status: level >= 2 ? "escaladee" : r.status,
        due_at: dueFromPriority(r.priority),
      } as never)
      .eq("id", r.id);
    if (upErr) throw upErr;
    await logEvent(r.id, "escalade", `Escalade niveau ${level} — ${ESCALATION_LABELS[level]}`, { name: "Automatisation" });
    escalated += 1;
  }
  return escalated;
}