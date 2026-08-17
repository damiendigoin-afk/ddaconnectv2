import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PhotoManager } from "@/components/PhotoManager";
import { blobToDataUrl, compressImage, uploadPhoto } from "@/lib/photo";
import { ocrOdometer } from "@/lib/ocr.functions";
import { saveMileage } from "@/lib/tour";

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
  const [value, setValue] = useState(current ? String(current) : "");
  const [detected, setDetected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastMediaId, setLastMediaId] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);

  async function analyse(file: File) {
    setBusy(true);
    // La photo est toujours conservée en pleine qualité, même si l'OCR échoue.
    try {
      if (inspectionId) {
        try {
          const media = await uploadPhoto(file, `inspections/${inspectionId}`, {
            inspection_id: inspectionId,
            ...(pointId ? { inspection_point_id: pointId } : {}),
            label: "Compteur",
          });
          setLastMediaId(media.id as string);
        } catch (e) {
          console.error(e);
          toast.error("Photo du compteur non enregistrée. Reprenez la photo.");
        }
      }
      const dataUrl = await blobToDataUrl(await compressImage(file, 1500, 0.85));
      const res = await ocrOdometer({ data: { dataUrl } });
      if (res.ok) {
        setDetected(res.mileage);
        setValue(String(res.mileage));
      } else {
        toast.error(`${res.error} Saisissez le kilométrage manuellement.`);
      }
    } catch (e) {
      console.error(e);
      toast.error("Photo du compteur non analysée. Saisie manuelle possible.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const km = parseInt(value.replace(/\D/g, ""), 10);
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
    await saveMileage({
      vehicleId,
      inspectionId: inspectionId ?? null,
      mileage: km,
      mediaId: lastMediaId,
      previous,
    });
    onSaved(km);
    toast.success("Kilométrage enregistré");
  }

  return (
    <div className="card-surface space-y-3 border-2 border-brand p-4">
      <h3 className="font-bold uppercase">{title ?? "Kilométrage compteur"}</h3>
      <p className="text-xs text-muted-foreground">
        Dernier kilométrage connu : {previous ? `${previous.toLocaleString("fr-FR")} km` : "—"}
      </p>
      <button
        type="button"
        onClick={() => camRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 font-bold uppercase text-brand-foreground"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        Photographier le compteur
      </button>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void analyse(f);
        }}
      />
      {detected ? (
        <p className="rounded-lg bg-status-ok-soft px-3 py-2 text-sm font-semibold">
          Kilométrage détecté : {detected.toLocaleString("fr-FR")} km — confirmez ou modifiez.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
          placeholder="78452"
          className="flex-1 rounded-lg border-2 border-border px-3 py-3 text-xl font-bold outline-none focus:border-brand"
        />
        <span className="font-bold">km</span>
      </div>
      <button
        type="button"
        onClick={() => void confirm()}
        className="w-full rounded-lg bg-primary px-3 py-3 font-bold uppercase text-primary-foreground"
      >
        Confirmer le kilométrage
      </button>
      {inspectionId ? (
        <PhotoManager
          compact
          folder={`inspections/${inspectionId}`}
          links={{ inspection_id: inspectionId, ...(pointId ? { inspection_point_id: pointId } : {}) }}
        />
      ) : null}
    </div>
  );
}