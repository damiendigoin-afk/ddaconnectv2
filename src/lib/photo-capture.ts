/**
 * Flux photo partagé du Tour guidé (compteur, voyants, contrôles, roues).
 *
 * Chrome Android / PWA (Pixel 7) renvoie régulièrement un File incomplet :
 * nom vide, type MIME absent ou `image/webp`, taille énorme, voire blob à 0 octet.
 * Toutes les cartes photo passent désormais par la même normalisation et la même
 * exécution protégée : aucun échec ne remonte au rendu React.
 */

import { normalizeCapturedFile, runStep, type MileageStep, type NormalizedCapture } from "@/lib/mileage-capture";
import { compressImage, uploadPhoto, uploadPhotoOriginal, type MediaLinks } from "@/lib/photo";

export type CaptureResult =
  | { ok: true; media: unknown; capture: NormalizedCapture }
  | { ok: false; step: MileageStep; message: string };

/** Normalisation commune : renvoie null au lieu de jeter sur un retour caméra invalide. */
export function prepareCapture(input: unknown): NormalizedCapture | null {
  return normalizeCapturedFile(input);
}

/**
 * Envoie une photo issue de l'appareil sans jamais jeter.
 * Les fichiers hors norme sont réduits avant envoi ; en cas d'échec de la
 * réduction, l'original est envoyé plutôt que d'abandonner la photo.
 */
export async function uploadCapture(
  input: unknown,
  folder: string,
  links: MediaLinks,
): Promise<CaptureResult> {
  const capture = prepareCapture(input);
  if (!capture) {
    return {
      ok: false,
      step: "camera_return",
      message: "Photo non récupérée par l'appareil. Reprenez la photo.",
    };
  }
  const sent = await runStep(
    "upload",
    async () => {
      if (capture.tooLarge) {
        const reduced = await compressImage(capture.blob, 2000, 0.85).catch(() => capture.blob);
        return uploadPhoto(reduced, folder, links, { alreadyCompressed: true });
      }
      return uploadPhoto(capture.blob, folder, links);
    },
    { sizeMb: Math.round(capture.sizeMb), mime: capture.type },
  );
  if (sent.ok) return { ok: true, media: sent.value, capture };

  // Dernier recours : envoi de l'original sans décodage navigateur.
  const raw = await runStep("upload", () => uploadPhotoOriginal(capture.blob, folder, links), {
    fallback: true,
  });
  if (raw.ok) return { ok: true, media: raw.value, capture };
  return {
    ok: false,
    step: "upload",
    message: "Photo non envoyée. Réessayez ou continuez sans photo.",
  };
}
