import { useRef, useState } from "react";
import { localDocText } from "@/lib/doc-text.browser";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ctPersistValues, firstValidCtDate, mergeCtComment } from "@/lib/ct";
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
  const [ctDate, setCtDate] = useState(firstValidCtDate(initialCt) ?? "");
  const [pollutionDate, setPollutionDate] = useState(firstValidCtDate(initialPollution) ?? "");
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
      const result = await ocrTechnicalControl({ data: { text: await localDocText(await blobToDataUrl(scan)), dataUrl: await blobToDataUrl(scan), filename: file.name } });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const parsed = JSON.parse(result.json) as CtRead;
      const readCt = firstValidCtDate(parsed.ct_due_date);
      const readPollution = firstValidCtDate(parsed.pollution_due_date);
      // Lecture vide : on conserve la date déjà connue (point ou fiche véhicule).
      const nextCt = readCt ?? ctDate;
      const nextPollution = readPollution ?? pollutionDate;
      setCtDate(nextCt);
      setPollutionDate(nextPollution);
      setIsUtility(parsed.vehicle_kind === "vu" || Boolean(nextPollution));
      await persist(readCt ?? "", readPollution ?? "", media.id, false, nextCt, nextPollution);
      if (readCt) toast.success("Échéance du contrôle technique lue");
      else toast.warning("Date CT non lue sur la photo : date existante conservée, saisissez-la si besoin.");
    } catch (error) {
      console.error(error);
      toast.error("Photo conservée, mais la lecture automatique a échoué. Saisissez les dates manuellement.");
    } finally {
      setBusy(false);
    }
  }

  async function persist(
    ct: string,
    pollution: string,
    mediaId?: string,
    manual = true,
    commentCt = ct,
    commentPollution = pollution,
  ) {
    const values = ctPersistValues(ct, pollution, manual);
    const now = new Date().toISOString();
    // Le commentaire du point reprend la date structurée : partie automatique
    // régénérée sans doublon, commentaire manuel conservé.
    const { data: current } = await supabase
      .from("inspection_points")
      .select("comment")
      .eq("id", pointId)
      .maybeSingle();
    const pointPatch = {
      ...values,
      ct_read_at: now,
      ct_source: manual ? "manuel" : "ocr",
      ct_manually_corrected: manual,
      comment: mergeCtComment(current?.comment ?? "", commentCt, commentPollution),
    };
    const vehiclePatch = {
      ...values,
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

  // Saisie manuelle : enregistrée dès qu'une date complète est choisie (le
  // sélecteur Android ne déclenche pas toujours la perte de focus), puis au blur.
  const saved = useRef({ ct: firstValidCtDate(initialCt) ?? "", pollution: firstValidCtDate(initialPollution) ?? "" });
  async function saveManual(ct: string, pollution: string) {
    if (saved.current.ct === ct && saved.current.pollution === pollution) return;
    try {
      await persist(ct, pollution);
      saved.current = { ct, pollution };
    } catch (error) {
      console.error(error);
      toast.error("Échéance CT non enregistrée. Vérifiez la connexion puis ressaisissez la date.");
    }
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
          onChange={(event) => {
            const v = event.target.value;
            setCtDate(v);
            if (!v || firstValidCtDate(v)) void saveManual(v, pollutionDate);
          }}
          onBlur={() => void saveManual(ctDate, pollutionDate)}
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
            onChange={(event) => {
              const v = event.target.value;
              setPollutionDate(v);
              if (!v || firstValidCtDate(v)) void saveManual(ctDate, v);
            }}
            onBlur={() => void saveManual(ctDate, pollutionDate)}
            className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-foreground"
          />
        </label>
      ) : null}
    </div>
  );
}