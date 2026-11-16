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

/**
 * File locale (appareil) des réponses pression non envoyées faute de réseau.
 * Clé = id de la roue : jamais copiée vers une autre roue ; la dernière réponse gagne.
 */
const PENDING_KEY = "dda.tourTirePressurePending.v1";

function readPending(): Record<string, boolean> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PENDING_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch { return {}; }
}
function writePending(v: Record<string, boolean>) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(v)); } catch { /* stockage indisponible */ }
}

export function pendingTirePressure(pointId: string): boolean | undefined {
  const v = readPending()[pointId];
  return typeof v === "boolean" ? v : undefined;
}

export function queueTirePressure(pointId: string, checked: boolean) {
  writePending({ ...readPending(), [pointId]: checked });
}

/** Renvoie les réponses en attente ; celles qui échouent restent dans la file. */
export async function flushPendingTirePressure(save = saveTourTirePressureChecked): Promise<number> {
  const pending = readPending();
  let sent = 0;
  for (const [id, checked] of Object.entries(pending)) {
    try {
      await save(id, checked);
      const now = readPending();
      if (now[id] === checked) { delete now[id]; writePending(now); }
      sent += 1;
    } catch { /* reste en file */ }
  }
  return sent;
}
