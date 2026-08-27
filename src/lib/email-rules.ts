import { supabase } from "@/integrations/supabase/client";
import { findPlates, matchEmailRule, type EmailRule } from "@/lib/emails-core";

export type { EmailRule };

export const RULE_TYPE_LABELS: Record<EmailRule["match_type"], string> = {
  sender: "Expéditeur",
  domain: "Domaine",
  subject: "Mot de l'objet",
};

export async function fetchEmailRules(): Promise<EmailRule[]> {
  const { data, error } = await supabase
    .from("email_rules")
    .select("id, match_type, match_value, category")
    .order("match_type")
    .order("match_value");
  if (error) throw error;
  return (data ?? []) as EmailRule[];
}

/** Affectation manuelle d'un seul e-mail (aucune règle mémorisée). */
export async function setEmailCategory(id: string, category: string) {
  const { error } = await supabase
    .from("emails")
    .update({ category, category_confidence: 1, category_source: "manuel" })
    .eq("id", id);
  if (error) throw error;
}

/**
 * « Toujours pour cet expéditeur » : règle déterministe sur l'adresse exacte,
 * appliquée immédiatement à tous les e-mails déjà reçus de cet expéditeur.
 */
export async function alwaysForSender(fromAddress: string, category: string, authorName?: string | null) {
  const value = fromAddress.trim().toLowerCase();
  await upsertEmailRule({ matchType: "sender", matchValue: value, category, authorName: authorName ?? null });
  const { error } = await supabase
    .from("emails")
    .update({ category, category_confidence: 1, category_source: "regle" })
    .eq("from_address", value);
  if (error) throw error;
}

export async function upsertEmailRule(input: {
  matchType: EmailRule["match_type"];
  matchValue: string;
  category: string;
  authorName?: string | null;
}) {
  const { error } = await supabase.from("email_rules").upsert(
    {
      match_type: input.matchType,
      match_value: input.matchValue.trim().toLowerCase().replace(/^@/, ""),
      category: input.category,
      created_by_name: input.authorName ?? null,
    },
    { onConflict: "match_type,match_value" },
  );
  if (error) throw error;
}

export async function updateEmailRuleCategory(id: string, category: string) {
  const { error } = await supabase.from("email_rules").update({ category }).eq("id", id);
  if (error) throw error;
}

export async function deleteEmailRule(id: string) {
  const { error } = await supabase.from("email_rules").delete().eq("id", id);
  if (error) throw error;
}

/** Réapplique toutes les règles aux e-mails déjà reçus (rattrapage manuel). */
export async function replayEmailRules(): Promise<number> {
  const rules = await fetchEmailRules();
  if (!rules.length) return 0;
  const { data } = await supabase
    .from("emails")
    .select("id, from_address, subject, category")
    .order("sent_at", { ascending: false })
    .limit(500);
  let changed = 0;
  for (const row of data ?? []) {
    const hit = matchEmailRule(rules, { from: row.from_address, subject: row.subject });
    if (!hit || hit.category === row.category) continue;
    await supabase
      .from("emails")
      .update({ category: hit.category, category_confidence: 1, category_source: "regle" })
      .eq("id", row.id);
    changed += 1;
  }
  return changed;
}

/* --------------------------- Rattachement véhicule --------------------------- */

export type EmailLinkCandidate = {
  vehicleId: string;
  clientId: string | null;
  plate: string;
  label: string;
};

/** Recherche par immatriculation exacte (regex + comparaison base, sans IA ni OCR). */
export async function findEmailVehicleCandidates(email: {
  subject?: string | null;
  body_text?: string | null;
  attachmentNames?: string[];
}): Promise<{ plates: string[]; candidates: EmailLinkCandidate[] }> {
  const plates = findPlates(
    [email.subject ?? "", email.body_text ?? "", (email.attachmentNames ?? []).join(" ")].join(" "),
  );
  if (!plates.length) return { plates, candidates: [] };
  const { data } = await supabase
    .from("vehicles")
    .select("id, plate, plate_normalized, brand, model, client_id")
    .in("plate_normalized", plates);
  return {
    plates,
    candidates: (data ?? []).map((v) => ({
      vehicleId: v.id,
      clientId: v.client_id,
      plate: v.plate_normalized ?? v.plate,
      label: [v.plate, v.brand, v.model].filter(Boolean).join(" · "),
    })),
  };
}

export async function attachEmailToVehicle(
  emailId: string,
  c: { vehicleId: string; clientId: string | null; plate: string },
  status: "auto" | "confirme" = "confirme",
) {
  const { error } = await supabase
    .from("emails")
    .update({
      vehicle_id: c.vehicleId,
      client_id: c.clientId,
      detected_plate: c.plate,
      link_status: status,
    })
    .eq("id", emailId);
  if (error) throw error;
}

export async function detachEmail(emailId: string) {
  const { error } = await supabase
    .from("emails")
    .update({ vehicle_id: null, client_id: null, link_status: "none" })
    .eq("id", emailId);
  if (error) throw error;
}
