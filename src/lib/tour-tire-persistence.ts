import { supabase } from "@/integrations/supabase/client";
import { withTirePressureChecked } from "./tour-tire-pressure";

type AnalysisPatch = Record<string, unknown> & { tire_analysis: unknown };

/**
 * Met à jour une roue à partir du JSON le plus récent. Le filtre updated_at
 * empêche un ancien snapshot d'écraser une analyse ou une coche enregistrée
 * entre la lecture et l'écriture ; trois lectures fraîches sont possibles.
 */
export async function updateTourTireAnalysis(
  pointId: string,
  makePatch: (currentAnalysis: unknown) => AnalysisPatch,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from("inspection_points")
      .select("tire_analysis, updated_at")
      .eq("id", pointId)
      .single();
    if (readError) throw readError;

    const patch = makePatch(current.tire_analysis);
    let write = supabase
      .from("inspection_points")
      .update({ ...patch, updated_at: new Date().toISOString() } as never)
      .eq("id", pointId);
    write = current.updated_at
      ? write.eq("updated_at", current.updated_at)
      : write.is("updated_at", null);

    const { data: saved, error: writeError } = await write.select("id").maybeSingle();
    if (writeError) throw writeError;
    if (saved) return;
  }
  throw new Error("La roue a été modifiée pendant l’enregistrement. Réessayez.");
}

export async function saveTourTirePressureChecked(pointId: string, checked: boolean): Promise<void> {
  await updateTourTireAnalysis(pointId, (current) => ({
    tire_analysis: withTirePressureChecked(current, checked),
  }));
}
