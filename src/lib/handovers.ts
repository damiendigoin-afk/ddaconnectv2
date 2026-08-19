import { supabase } from "@/integrations/supabase/client";

export type Handover = {
  id: string;
  site_id: string | null;
  kind: string;
  plate: string | null;
  vin: string | null;
  model: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  scheduled_at: string | null;
  done_at: string | null;
  status: string;
  checklist: Record<string, boolean>;
  notes: string | null;
};

export const HANDOVER_KINDS = [
  { key: "recuperation", label: "Récupération" },
  { key: "vn", label: "Livraison VN" },
  { key: "vo", label: "Livraison VO" },
] as const;

export const HANDOVER_STATUS = [
  { key: "planifie", label: "Planifié" },
  { key: "en_cours", label: "En cours" },
  { key: "termine", label: "Terminé" },
  { key: "annule", label: "Annulé" },
] as const;

export const CHECKLIST: Record<string, readonly { key: string; label: string }[]> = {
  recuperation: [
    { key: "cle", label: "Clés récupérées" },
    { key: "carte_grise", label: "Carte grise / documents" },
    { key: "etat", label: "État des lieux photo" },
    { key: "carburant", label: "Niveau carburant relevé" },
    { key: "km", label: "Kilométrage relevé" },
  ],
  vn: [
    { key: "preparation", label: "Préparation esthétique" },
    { key: "plaques", label: "Plaques posées" },
    { key: "documents", label: "Dossier de livraison complet" },
    { key: "prise_en_main", label: "Prise en main client" },
    { key: "carburant", label: "Plein effectué" },
  ],
  vo: [
    { key: "controle", label: "Contrôle technique valide" },
    { key: "preparation", label: "Préparation esthétique" },
    { key: "garantie", label: "Garantie remise" },
    { key: "documents", label: "Dossier de vente complet" },
    { key: "prise_en_main", label: "Prise en main client" },
  ],
};

export function labelOf(list: readonly { key: string; label: string }[], key: string) {
  return list.find((x) => x.key === key)?.label ?? key;
}

export async function listHandovers(): Promise<Handover[]> {
  const { data, error } = await supabase
    .from("vehicle_handovers")
    .select("id, site_id, kind, plate, vin, model, customer_name, customer_phone, address, scheduled_at, done_at, status, checklist, notes")
    .order("scheduled_at", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...(r as Handover), checklist: ((r as { checklist: unknown }).checklist ?? {}) as Record<string, boolean> }));
}

export async function createHandover(input: Partial<Handover>) {
  const { error } = await supabase.from("vehicle_handovers").insert(input as never);
  if (error) throw error;
}

export async function updateHandover(id: string, patch: Partial<Handover>) {
  const { error } = await supabase.from("vehicle_handovers").update(patch as never).eq("id", id);
  if (error) throw error;
}