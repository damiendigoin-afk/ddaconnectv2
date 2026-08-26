import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { mergeCtComment } from "@/lib/ct";
import { ocrTechnicalControl } from "@/lib/ocr.functions";
import { blobToDataUrl, compressImage, uploadPhoto } from "@/lib/photo";


type CtRead = {
  ct_due_date?: string | null;
  pollution_due_date?: string | null;
  vehicle_kind?: "vp" | "vu";
};

export function TechnicalControlCard({
  pointId,
  tourId,
  vehicleId,
  initialCt,
  initialPollution,
}: {
  pointId: string;
  tourId: string;
  vehicleId: string;
  initialCt?: string | null;
  initialPollution?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ctDate, setCtDate] = useState(initialCt ?? "");
  const [pollutionDate, setPollutionDate] = useState(initialPollution ?? "");
  const [isUtility, setIsUtility] = useState(Boolean(initialPollution));
  const [busy, setBusy] = useState(false);

  async function read(file: File) {
    setBusy(true);
    try {
      const media = await uploadPhoto(file, `tours/${tourId}/controle-technique`, {
        inspection_id: tourId,
        inspection_point_id: pointId,
        label: "Contrôle technique",
      });
      const scan = await compressImage(file, 1600, 0.82);
      const result = await ocrTechnicalControl({ data: { dataUrl: await blobToDataUrl(scan), filename: file.name } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const parsed = JSON.parse(result.json) as CtRead;
      setCtDate(parsed.ct_due_date ?? "");
      setPollutionDate(parsed.pollution_due_date ?? "");
      setIsUtility(parsed.vehicle_kind === "vu" || Boolean(parsed.pollution_due_date));
      await persist(parsed.ct_due_date ?? "", parsed.pollution_due_date ?? "", media.id, false);
      toast.success("Échéance du contrôle technique lue");
    } catch (error) {
      console.error(error);
      toast.error("Photo conservée, mais la lecture automatique a échoué. Saisissez les dates manuellement.");
    } finally {
      setBusy(false);
    }
  }

  async function persist(ct: string, pollution: string, mediaId?: string, manual = true) {
    const now = new Date().toISOString();
    // Le commentaire du point reprend la date structurée : partie automatique
    // régénérée sans doublon, commentaire manuel conservé.
    const { data: current } = await supabase
      .from("inspection_points")
      .select("comment")
      .eq("id", pointId)
      .maybeSingle();
    const pointPatch = {
      ct_due_date: ct || null,
      pollution_due_date: pollution || null,
      ct_read_at: now,
      ct_source: manual ? "manuel" : "ocr",
      ct_manually_corrected: manual,
      comment: mergeCtComment(current?.comment ?? "", ct, pollution),
    };
    const vehiclePatch = {
      ct_due_date: ct || null,
      pollution_due_date: pollution || null,
      ...(mediaId ? { ct_photo_media_id: mediaId } : {}),
      ct_read_at: now,
      ct_source: manual ? "manuel" : "ocr",
      ct_manually_corrected: manual,
    };
    const [{ error: pointError }, { error: vehicleError }] = await Promise.all([
      supabase.from("inspection_points").update(pointPatch).eq("id", pointId),
      supabase.from("vehicles").update(vehiclePatch).eq("id", vehicleId),
    ]);
    if (pointError) throw pointError;
    if (vehicleError) throw vehicleError;
  }


  return (
    <div className="mt-3 space-y-3 rounded-lg border-2 border-border p-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-3 text-sm font-bold uppercase text-brand-foreground"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        Photographier la vignette CT
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void read(file);
        }}
      />
      <label className="block text-xs font-bold uppercase text-muted-foreground">
        Prochaine échéance CT
        <input
          type="date"
          value={ctDate}
          onChange={(event) => setCtDate(event.target.value)}
          onBlur={() => void persist(ctDate, pollutionDate)}
          className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-foreground"
        />
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={isUtility} onChange={(event) => setIsUtility(event.target.checked)} />
        Véhicule utilitaire — contrôle pollution
      </label>
      {isUtility ? (
        <label className="block text-xs font-bold uppercase text-muted-foreground">
          Prochaine échéance pollution
          <input
            type="date"
            value={pollutionDate}
            onChange={(event) => setPollutionDate(event.target.value)}
            onBlur={() => void persist(ctDate, pollutionDate)}
            className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-foreground"
          />
        </label>
      ) : null}
    </div>
  );
}