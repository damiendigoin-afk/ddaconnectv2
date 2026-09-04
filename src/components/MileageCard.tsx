import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { blobToDataUrl, compressImage, uploadPhotoOriginal, uploadPhoto } from "@/lib/photo";
import { ocrStoredOdometer } from "@/lib/mileage-ocr.functions";
import { ocrOdometer } from "@/lib/ocr.functions";
import { saveMileage } from "@/lib/tour";
import {
  logMileageFailure,
  normalizeCapturedFile,
  parseMileageInput,
  runStep,
  type MileageStep,
} from "@/lib/mileage-capture";

/**
 * Repli fonctionnel : si l'affichage de la carte kilométrage est interrompu,
 * l'opérateur conserve la saisie manuelle et la reprise de la photo — le
 * message « affichage interrompu » n'est jamais un cul-de-sac.
 */
export function MileageManualFallback({
  vehicleId,
  inspectionId,
  previous,
  onSaved,
  onRetry,
}: {
  vehicleId: string;
  inspectionId?: string | undefined;
  previous: number | null;
  onSaved: (value: number) => void;
  onRetry: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const km = parseMileageInput(value);
    if (!km) {
      setError("Kilométrage invalide.");
      return;
    }
    setSaving(true);
    const saved = await runStep("save", () =>
      saveMileage({ vehicleId, inspectionId: inspectionId ?? null, mileage: km, mediaId: null, previous }),
    );
    setSaving(false);
    if (!saved.ok) {
      setError("Kilométrage non enregistré. Réessayez.");
      return;
    }
    setError(null);
    onSaved(km);
    toast.success("Kilométrage enregistré");
  }

  return (
    <div className="card-surface space-y-3 border-2 border-brand p-4">
      <h3 className="font-bold uppercase">Kilométrage compteur</h3>
      <p className="text-xs text-muted-foreground">
        Saisie manuelle disponible. Dernier kilométrage connu : {(previous ?? 0).toLocaleString("fr-FR")} km
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Kilométrage compteur"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          placeholder="Kilométrage relevé"
          className="flex-1 rounded-lg border-2 border-border px-3 py-3 text-xl font-bold outline-none focus:border-brand"
        />
        <span className="font-bold">km</span>
      </div>
      {error ? <p className="text-sm font-semibold text-destructive">{error}</p> : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        className="w-full rounded-lg bg-primary px-3 py-3 font-bold uppercase text-primary-foreground disabled:opacity-60"
      >
        Confirmer le kilométrage
      </button>
      <button
        type="button"
        onClick={onRetry}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase"
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
        Reprendre la photo du compteur
      </button>
    </div>
  );
}

export function MileageCard({
  inspectionId,
  pointId,
  vehicleId,
  previous,
  current,
  onSaved,
  title,
}: {
  inspectionId?: string | undefined;
  pointId?: string | undefined;
  vehicleId: string;
  title?: string;
  previous: number | null;
  current: number | null;
  onSaved: (value: number) => void;
}) {
  // §36 — aucune valeur arbitraire préremplie : le champ part vide tant que rien n'est saisi.
  const [value, setValue] = useState(current ? String(current) : "");
  const [detected, setDetected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<{ step: MileageStep; message: string } | null>(null);
  const [lastMediaId, setLastMediaId] = useState<string | null>(null);
  const pendingFile = useRef<Blob | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  // §35 — à l'ouverture, le curseur se place dans le champ (clavier numérique).
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  /**
   * Chaque sous-étape (retour caméra, compression, upload, OCR) est protégée :
   * un échec affiche une erreur locale et laisse la saisie manuelle disponible,
   * la page complète n'est jamais mise en défaut.
   */
  async function analyse(input: unknown) {
    if (busy) return;
    const capture = normalizeCapturedFile(input);
    if (!capture) {
      logMileageFailure("camera_return", new Error("fichier caméra vide ou invalide"));
      setLocalError({
        step: "camera_return",
        message: "Photo du compteur non récupérée. Reprenez la photo ou saisissez le kilométrage.",
      });
      return;
    }
    pendingFile.current = capture.blob;
    setBusy(true);
    setLocalError(null);
    try {
      if (inspectionId) {
        // Ne jamais décoder localement la photo 50 Mpx : l'upload direct reste
        // stable sur Pixel 7, puis l'OCR lit le fichier côté serveur.
        const uploaded = await runStep(
          "upload",
          async () => {
            if (capture.tooLarge) {
              // Fichier hors norme : on réduit avant envoi, et si la réduction
              // échoue on retombe sur l'original plutôt que d'abandonner.
              const reduced = await compressImage(capture.blob, 2000, 0.85).catch(() => capture.blob);
              return uploadPhoto(reduced, `inspections/${inspectionId}`, {
                inspection_id: inspectionId,
                ...(pointId ? { inspection_point_id: pointId } : {}),
                label: "Compteur",
              }, { alreadyCompressed: true });
            }
            return uploadPhotoOriginal(capture.blob, `inspections/${inspectionId}`, {
              inspection_id: inspectionId,
              ...(pointId ? { inspection_point_id: pointId } : {}),
              label: "Compteur",
            });
          },
          { sizeMb: Math.round(capture.sizeMb), mime: capture.type },
        );
        if (!uploaded.ok) {
          setLocalError({
            step: uploaded.step,
            message: "Photo non envoyée. Réessayez ou saisissez le kilométrage manuellement.",
          });
          return;
        }
        const media = uploaded.value as { id?: unknown; storage_path?: unknown } | null;
        const mediaId = typeof media?.id === "string" ? media.id : null;
        const storagePath = typeof media?.storage_path === "string" ? media.storage_path : null;
        setLastMediaId(mediaId);
        if (!storagePath) {
          setLocalError({
            step: "upload",
            message: "Photo enregistrée sans référence exploitable. Saisissez le kilométrage manuellement.",
          });
          return;
        }
        const read = await runStep("ocr", () => ocrStoredOdometer({ data: { path: storagePath } }));
        if (!read.ok) {
          setLocalError({
            step: "ocr",
            message: "Lecture automatique indisponible. Saisissez le kilométrage manuellement.",
          });
          return;
        }
        applyOcr(read.value);
        return;
      }

      // Mise à jour hors tour : conserver le parcours historique allégé.
      const prepared = await runStep("compression", async () => {
        const base = await compressImage(capture.blob, 1400, 0.82);
        return blobToDataUrl(base);
      });
      if (!prepared.ok) {
        setLocalError({
          step: "compression",
          message: "Photo non exploitable sur cet appareil. Saisissez le kilométrage manuellement.",
        });
        return;
      }
      const read = await runStep("ocr", () =>
        ocrOdometer({ data: { dataUrl: prepared.value, filename: capture.name } }),
      );
      if (!read.ok) {
        setLocalError({
          step: "ocr",
          message: "Lecture automatique indisponible. Saisissez le kilométrage manuellement.",
        });
        return;
      }
      applyOcr(read.value);
    } catch (error) {
      // Filet de sécurité : aucune exception ne remonte au rendu.
      logMileageFailure("unknown", error);
      setLocalError({
        step: "unknown",
        message: "Étape photo interrompue. Réessayez ou saisissez le kilométrage manuellement.",
      });
    } finally {
      setBusy(false);
    }
  }

  function applyOcr(res: { ok: boolean; error?: string; mileage?: number }) {
    const km = res.ok ? parseMileageInput(res.mileage) : null;
    if (km) {
      setDetected(km);
      setValue(String(km));
      return;
    }
    setLocalError({
      step: "ocr",
      message: `${res.error || "Kilométrage non détecté."} Saisissez-le manuellement.`,
    });
  }

  function retry() {
    const file = pendingFile.current;
    setLocalError(null);
    if (file) void analyse(file);
    else camRef.current?.click();
  }

  async function confirm() {
    if (saving) return;
    const km = parseMileageInput(value);
    if (!km) {
      toast.error("Kilométrage invalide");
      return;
    }
    if (previous != null && km < previous) {
      const ok = window.confirm(
        `Attention : ${km.toLocaleString("fr-FR")} km est inférieur au dernier kilométrage connu (${previous.toLocaleString("fr-FR")} km). Confirmer quand même ?`,
      );
      if (!ok) return;
    }
    setSaving(true);
    const saved = await runStep("save", () =>
      saveMileage({
        vehicleId,
        inspectionId: inspectionId ?? null,
        mileage: km,
        mediaId: lastMediaId,
        previous,
      }),
    );
    setSaving(false);
    if (!saved.ok) {
      setLocalError({ step: "save", message: "Kilométrage non enregistré. Réessayez." });
      return;
    }
    setLocalError(null);
    onSaved(km);
    toast.success("Kilométrage enregistré");
  }

  return (
    <div className="card-surface space-y-3 border-2 border-brand p-4">
      <h3 className="font-bold uppercase">{title ?? "Kilométrage compteur"}</h3>
      <p className="text-xs text-muted-foreground">
        Dernier kilométrage connu : {(previous ?? 0).toLocaleString("fr-FR")} km
        <span className="block">Référence uniquement — le kilométrage actuel doit être confirmé.</span>
      </p>

      <button
        type="button"
        onClick={() => camRef.current?.click()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 font-bold uppercase text-brand-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Camera className="h-5 w-5" aria-hidden />}
        Photographier le compteur
      </button>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          e.target.value = "";
          void analyse(f);
        }}
      />
      {detected ? (
        <p className="rounded-lg bg-status-ok-soft px-3 py-2 text-sm font-semibold">
          Kilométrage détecté : {detected.toLocaleString("fr-FR")} km — confirmez ou modifiez.
        </p>
      ) : null}
      {localError ? (
        <div className="space-y-2 rounded-lg border-2 border-destructive px-3 py-2 text-sm">
          <p className="font-semibold">{localError.message}</p>
          <button
            type="button"
            onClick={retry}
            className="flex items-center gap-2 rounded-lg border-2 border-border px-3 py-2 text-xs font-bold uppercase"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Réessayer
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          ref={fieldRef}
          autoFocus
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Kilométrage compteur"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          placeholder="Kilométrage relevé"
          className="flex-1 rounded-lg border-2 border-border px-3 py-3 text-xl font-bold outline-none focus:border-brand"
        />
        <span className="font-bold">km</span>
      </div>
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={saving}
        className="w-full rounded-lg bg-primary px-3 py-3 font-bold uppercase text-primary-foreground disabled:opacity-60"
      >
        Confirmer le kilométrage
      </button>
    </div>
  );
}
