/**
 * Journalisation de la notification Front Office, isolée de tout le reste.
 *
 * Objectif : une tentative est tracée dans `tour_notifications` AVANT même le
 * chargement du service de notification. Si ce dernier échoue (dépendance,
 * PDF, réseau), la panne reste visible dans l'historique du tour au lieu de
 * disparaître silencieusement.
 */
export async function openTourNotifyAttempt(inspectionId: string): Promise<string | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("tour_notifications")
      .insert({ inspection_id: inspectionId, recipients: [], status: "pending" })
      .select("id")
      .single();
    if (error) {
      console.error("[tour-notify] ouverture du journal impossible", error);
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch (e) {
    console.error("[tour-notify] ouverture du journal impossible", e);
    return null;
  }
}

/** Clôture une tentative en échec (erreur technique hors service de notification). */
export async function failTourNotifyAttempt(logId: string | null, error: string): Promise<void> {
  if (!logId) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("tour_notifications")
      .update({ status: "failed", error_message: error.slice(0, 500) })
      .eq("id", logId);
  } catch (e) {
    console.error("[tour-notify] journalisation de l'échec impossible", e);
  }
}
