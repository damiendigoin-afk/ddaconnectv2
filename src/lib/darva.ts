import { supabase } from "@/integrations/supabase/client";

export type DarvaFlow = {
  id: string;
  site_id: string | null;
  case_id: string | null;
  reference: string | null;
  claim_ref: string | null;
  insurer: string | null;
  plate: string | null;
  message_type: string;
  direction: string;
  status: string;
  occurred_at: string;
  amount: number | null;
  notes: string | null;
};

export const DARVA_TYPES = [
  { key: "mission", label: "Mission" },
  { key: "rapport", label: "Rapport d'expertise" },
  { key: "accord", label: "Accord de réparation" },
  { key: "facture", label: "Facture" },
  { key: "reglement", label: "Règlement" },
  { key: "relance", label: "Relance" },
  { key: "litige", label: "Litige" },
] as const;

export const DARVA_STATUS = [
  { key: "a_traiter", label: "À traiter" },
  { key: "en_cours", label: "En cours" },
  { key: "attente_assureur", label: "Attente assureur" },
  { key: "accepte", label: "Accepté" },
  { key: "refuse", label: "Refusé" },
  { key: "clos", label: "Clos" },
] as const;

export function darvaLabel(list: readonly { key: string; label: string }[], key: string) {
  return list.find((x) => x.key === key)?.label ?? key;
}

export function darvaTone(status: string): string {
  if (status === "refuse" || status === "attente_assureur") return "bg-status-watch-soft text-status-watch";
  if (status === "accepte" || status === "clos") return "bg-secondary text-foreground";
  return "bg-brand/10 text-brand";
}

export async function listDarva(): Promise<DarvaFlow[]> {
  const { data, error } = await supabase
    .from("darva_flows")
    .select("id, site_id, case_id, reference, claim_ref, insurer, plate, message_type, direction, status, occurred_at, amount, notes")
    .order("occurred_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as DarvaFlow[];
}

export async function createDarva(input: Partial<DarvaFlow>) {
  const { error } = await supabase.from("darva_flows").insert(input as never);
  if (error) throw error;
}

export async function updateDarvaStatus(id: string, status: string) {
  const { error } = await supabase.from("darva_flows").update({ status }).eq("id", id);
  if (error) throw error;
}

/** Flux DARVA rattachés à un dossier (par dossier ou par immatriculation). */
export async function darvaForCase(caseId: string, plate: string | null): Promise<DarvaFlow[]> {
  const all = await listDarva();
  const p = (plate ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return all.filter(
    (f) => f.case_id === caseId || (!!p && (f.plate ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase() === p),
  );
}

export type DarvaAlert = { tone: "warn" | "info"; message: string };

/** Cohérence entre l'origine du dossier et les flux DARVA enregistrés. */
export function darvaCoherence(missionOrigin: string | null, flows: DarvaFlow[]): DarvaAlert | null {
  const isDarva = missionOrigin === "darva";
  if (isDarva && flows.length === 0) {
    return { tone: "warn", message: "Mission DARVA sans flux enregistré : crée le flux mission dans le module DARVA." };
  }
  if (!isDarva && flows.length > 0) {
    return {
      tone: "info",
      message: "Ce dossier est en OR classique mais des flux DARVA existent pour ce véhicule : vérifie l'origine de mission.",
    };
  }
  return null;
}