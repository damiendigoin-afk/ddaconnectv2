/**
 * Pilotage de l'agent WINmotor local (backend existant : RPC winmotor_agent_status,
 * winmotor_enqueue_job, table winmotor_agent_jobs avec RLS par site).
 * Lecture seule côté DDA : aucune écriture métier, aucun OR créé.
 */
import { supabase } from "@/integrations/supabase/client";

export type AgentStatus = {
  configured: boolean;
  online: boolean;
  name?: string | null;
  last_seen_at?: string | null;
  last_status?: Record<string, unknown> | null;
};

export type AgentJob = {
  id: string;
  command: string;
  status: string;
  error: string | null;
  result: unknown;
  payload: unknown;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const JOB_COLS = "id, command, status, error, result, payload, created_at, started_at, finished_at";

export async function fetchAgentStatus(siteId: string): Promise<AgentStatus> {
  const { data, error } = await supabase.rpc("winmotor_agent_status", { p_site_id: siteId });
  if (error) throw new Error(error.message);
  return (data ?? { configured: false, online: false }) as AgentStatus;
}

export async function enqueueJob(siteId: string, command: "PING" | "GET_OR", payload: Record<string, unknown>, priority = 10) {
  const { data, error } = await supabase.rpc("winmotor_enqueue_job", {
    p_site_id: siteId,
    p_command: command,
    p_payload: payload as never,
    p_priority: priority,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchJob(id: string): Promise<AgentJob | null> {
  const { data, error } = await supabase.from("winmotor_agent_jobs").select(JOB_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as AgentJob | null;
}

export async function fetchRecentJobs(siteId: string): Promise<AgentJob[]> {
  const { data, error } = await supabase
    .from("winmotor_agent_jobs")
    .select(JOB_COLS)
    .eq("site_id", siteId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as AgentJob[];
}

export const isFinal = (s: string) => s === "succeeded" || s === "failed" || s === "cancelled";

/** Attend la fin du job (succeeded/failed) ; timeout explicite. */
export async function waitJob(id: string, timeoutMs = 60_000, intervalMs = 1500, onTick?: (j: AgentJob | null) => void): Promise<AgentJob> {
  const t0 = Date.now();
  for (;;) {
    const j = await fetchJob(id);
    onTick?.(j);
    if (j && isFinal(j.status)) return j;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("Délai dépassé : l'agent WINmotor n'a pas répondu. Vérifiez qu'il est en ligne puis réessayez.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function jobDurationMs(j: Pick<AgentJob, "created_at" | "started_at" | "finished_at">): number | null {
  if (!j.finished_at) return null;
  const start = Date.parse(j.started_at ?? j.created_at);
  const end = Date.parse(j.finished_at);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Cherche une valeur par alias de clé (insensible casse/underscores). */
export function pick(o: unknown, ...keys: string[]): string | null {
  if (!isObj(o)) return null;
  const wanted = keys.map(norm);
  for (const [k, v] of Object.entries(o)) {
    if (wanted.includes(norm(k)) && v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function sub(o: unknown, ...keys: string[]): unknown {
  if (!isObj(o)) return null;
  const wanted = keys.map(norm);
  for (const [k, v] of Object.entries(o)) if (wanted.includes(norm(k)) && isObj(v)) return v;
  return null;
}

export type OrView = {
  or: string | null;
  client: { label: string; value: string | null }[];
  vehicle: { label: string; value: string | null }[];
};

/** Mise en forme lisible d'un résultat GET_OR (structure tolérante). */
export function orView(result: unknown): OrView {
  const root = sub(result, "data", "result") ?? result;
  const c = sub(root, "client", "customer") ?? root;
  const v = sub(root, "vehicule", "vehicle", "vehicle_info") ?? root;
  return {
    or: pick(root, "or", "or_number", "numero_or", "num_or", "numero"),
    client: [
      { label: "N° client", value: pick(c, "numero", "number", "code", "client_number", "num_client", "id") },
      { label: "Nom", value: pick(c, "nom", "name", "raison_sociale", "full_name") },
      { label: "Adresse", value: pick(c, "adresse", "address", "adresse1", "rue") },
      { label: "CP", value: pick(c, "cp", "code_postal", "postal_code", "zip") },
      { label: "Ville", value: pick(c, "ville", "city") },
      { label: "Téléphone", value: pick(c, "telephone", "tel", "phone", "portable", "mobile") },
      { label: "E-mail", value: pick(c, "email", "mail", "e_mail") },
    ],
    vehicle: [
      { label: "Immat", value: pick(v, "immat", "immatriculation", "plate", "plaque") },
      { label: "VIN", value: pick(v, "vin", "chassis", "num_serie") },
      { label: "Marque", value: pick(v, "marque", "brand", "make") },
      { label: "Modèle", value: pick(v, "modele", "model") },
      { label: "Version", value: pick(v, "version", "finition") },
      { label: "Date MEC", value: pick(v, "date_mec", "mec", "date_mise_en_circulation", "first_registration") },
      { label: "Année", value: pick(v, "annee", "year") },
      { label: "Type", value: pick(v, "type", "type_mine", "cnit") },
      { label: "Carrosserie", value: pick(v, "carrosserie", "body", "body_type") },
      { label: "Kilométrage", value: pick(v, "kilometrage", "km", "mileage", "kms") },
    ],
  };
}

export const COMMAND_LABELS: Record<string, string> = { PING: "Test connexion", GET_OR: "Lecture OR" };
export const STATUS_LABELS: Record<string, string> = {
  queued: "En attente",
  claimed: "Pris en charge",
  running: "En cours",
  succeeded: "Réussi",
  failed: "Échec",
  cancelled: "Annulé",
};
