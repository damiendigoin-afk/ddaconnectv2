/**
 * Aides pures pour l'étape « photo des kilomètres ».
 *
 * Chrome Android / PWA (Pixel 7) renvoie parfois un fichier appareil photo
 * incomplet : nom vide, type MIME absent ou `image/webp`, taille énorme.
 * Ces fonctions normalisent l'entrée et décrivent l'étape fautive sans jamais
 * jeter d'exception, pour que l'écran d'erreur global ne soit jamais atteint.
 */

export type MileageStep =
  | "camera_return"
  | "upload"
  | "ocr"
  | "compression"
  | "save"
  | "unknown";

export type NormalizedCapture = {
  blob: Blob;
  name: string;
  type: string;
  extension: "jpg" | "png" | "webp";
  sizeMb: number;
  tooLarge: boolean;
};

const MAX_DIRECT_UPLOAD_MB = 40;

/** Retour caméra tolérant : jamais de null/undefined non géré en aval. */
export function normalizeCapturedFile(input: unknown): NormalizedCapture | null {
  if (!input || typeof input !== "object") return null;
  const blob = input as Blob & { name?: string };
  if (typeof blob.size !== "number" || typeof blob.slice !== "function") return null;
  if (blob.size <= 0) return null;

  const rawType = typeof blob.type === "string" ? blob.type.toLowerCase() : "";
  const type = rawType.startsWith("image/") ? rawType : "image/jpeg";
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const rawName = typeof blob.name === "string" ? blob.name.trim() : "";
  const name = rawName || `compteur-${Date.now()}.${extension}`;
  const sizeMb = blob.size / (1024 * 1024);

  return { blob, name, type, extension, sizeMb, tooLarge: sizeMb > MAX_DIRECT_UPLOAD_MB };
}

/** Kilométrage saisi ou détecté : chiffres uniquement, borne réaliste. */
export function parseMileageInput(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  const km = Number.parseInt(digits, 10);
  if (!Number.isFinite(km) || km <= 0 || km > 2_000_000) return null;
  return km;
}

export function stepLabel(step: MileageStep): string {
  switch (step) {
    case "camera_return":
      return "Photo du compteur illisible (retour appareil photo).";
    case "compression":
      return "Préparation de la photo impossible.";
    case "upload":
      return "Envoi de la photo impossible.";
    case "ocr":
      return "Lecture automatique du compteur impossible.";
    case "save":
      return "Enregistrement du kilométrage impossible.";
    default:
      return "Étape kilométrage interrompue.";
  }
}

/** Journalisation technique : aucune photo, aucun nom de fichier, aucune donnée personnelle. */
export function logMileageFailure(step: MileageStep, error: unknown, meta?: Record<string, unknown>) {
  const err = error as { name?: string; message?: string } | null;
  console.error("[dda] étape kilométrage en échec", {
    step,
    errorName: err?.name ?? "Error",
    errorMessage: typeof err?.message === "string" ? err.message.slice(0, 200) : "inconnue",
    ...meta,
  });
}

/** Exécute une sous-étape sans jamais propager d'exception au rendu React. */
export async function runStep<T>(
  step: MileageStep,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<{ ok: true; value: T } | { ok: false; step: MileageStep; message: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    logMileageFailure(step, error, meta);
    return { ok: false, step, message: stepLabel(step) };
  }
}
