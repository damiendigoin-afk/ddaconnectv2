import { useEffect, useRef, useState } from "react";
import { localDocText } from "@/lib/doc-text.browser";
import { Camera, Check, Images, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { PhotoManager } from "@/components/PhotoManager";
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
  const gallery = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const readCtDocument = useServerFn(ocrTechnicalControl);
  const [ctDate, setCtDate] = useState(firstValidCtDate(initialCt) ?? "");
  const [pollutionDate, setPollutionDate] = useState(firstValidCtDate(initialPollution) ?? "");
  const [isUtility, setIsUtility] = useState(Boolean(initialPollution));
  const [busy, setBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  const [proposal, setProposal] = useState<{ ct: string; pollution: string; originalCt: string; originalPollution: string } | null>(null);
  const [readMessage, setReadMessage] = useState("");
  const reading = useRef(false);
  const saving = useRef(false);
  const saved = useRef({ ct: firstValidCtDate(initialCt) ?? "", pollution: firstValidCtDate(initialPollution) ?? "" });

  useEffect(() => {
    if (reading.current || saving.current) return;
    const ct = firstValidCtDate(initialCt) ?? "";
    const pollution = firstValidCtDate(initialPollution) ?? "";
    setCtDate(ct);
    setPollutionDate(pollution);
    saved.current = { ct, pollution };
  }, [initialCt, initialPollution]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tour", tourId] }),
      queryClient.invalidateQueries({ queryKey: ["points", tourId] }),
      queryClient.invalidateQueries({ queryKey: ["report", tourId] }),
    ]);
  }

  async function read(file: File) {
    if (reading.current) return;
    reading.current = true;
    setBusy(true);
    setProposal(null);
    setReadMessage("");
    let photoSaved = false;
    try {
      const media = await uploadPhoto(file, `tours/${tourId}/controle-technique`, {
        inspection_id: tourId,
        inspection_point_id: pointId,
        label: "Contrôle technique",
      });
      photoSaved = true;
      setPhotoKey((key) => key + 1);
      const { error: linkError } = await supabase.from("vehicles").update({ ct_photo_media_id: media.id }).eq("id", vehicleId);
      if (linkError) throw linkError;
      const scan = await compressImage(file, 1600, 0.82);
      const dataUrl = await blobToDataUrl(scan);
      const text = await localDocText(dataUrl).catch(() => "");
      const result = await readCtDocument({ data: { text, dataUrl, filename: file.name } });
      if (!result.ok) {
        setReadMessage("Photo enregistrée. Échéance non lue : saisissez ou corrigez la date manuellement.");
        return;
      }
      const parsed = JSON.parse(result.json) as CtRead;
      const readCt = firstValidCtDate(parsed.ct_due_date);
      const readPollution = firstValidCtDate(parsed.pollution_due_date);
      // Lecture vide : on conserve la date déjà connue (point ou fiche véhicule).
      const nextCt = readCt ?? ctDate;
      const nextPollution = readPollution ?? pollutionDate;
      setIsUtility(parsed.vehicle_kind === "vu" || Boolean(nextPollution));
      if (readCt || readPollution) setProposal({ ct: nextCt, pollution: nextPollution, originalCt: nextCt, originalPollution: nextPollution });
      setReadMessage(readCt ? "Échéance lue — à confirmer." : "Photo enregistrée. Échéance CT non lue : date existante conservée, saisie manuelle possible.");
    } catch (error) {
      console.error(error);
      const message = photoSaved
        ? "Photo conservée, mais la lecture automatique a échoué. Saisissez les dates manuellement."
        : "Photo non enregistrée. Réessayez la photo ou saisissez la date manuellement.";
      setReadMessage(message);
      toast.error(message);
    } finally {
      setBusy(false);
      reading.current = false;
      await refresh();
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
    const { data: current, error: commentError } = await supabase
      .from("inspection_points")
      .select("comment")
      .eq("id", pointId)
      .maybeSingle();
    if (commentError) throw commentError;
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
    await refresh();
  }

  // Saisie manuelle : enregistrée dès qu'une date complète est choisie (le
  // sélecteur Android ne déclenche pas toujours la perte de focus), puis au blur.
  async function saveManual(ct: string, pollution: string) {
    if (saving.current || reading.current) return;
    if (saved.current.ct === ct && saved.current.pollution === pollution) return;
    saving.current = true;
    try {
      setBusy(true);
      await persist(ct, pollution);
      saved.current = { ct, pollution };
    } catch (error) {
      console.error(error);
      toast.error("Échéance CT non enregistrée. Vérifiez la connexion puis ressaisissez la date.");
    } finally {
      setBusy(false);
      saving.current = false;
    }
  }


  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
      <Button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="h-auto w-full whitespace-normal px-3 py-3 text-sm font-bold"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        Photographier le contrôle technique
      </Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => gallery.current?.click()} className="h-auto w-full whitespace-normal px-3 py-3 text-sm font-bold">
        <Images className="h-4 w-4" /> Importer le contrôle technique
      </Button>
      </div>
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
      <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void read(file);
      }} />
      <p className="text-xs text-muted-foreground">Vignette ou photo du procès-verbal de contrôle technique</p>
      {readMessage ? <p role="status" className="text-sm font-semibold">{readMessage}</p> : null}
      {proposal ? <div className="space-y-2 border-l-2 border-primary pl-3">
        <label className="block text-sm font-semibold">Échéance CT lue
          <input type="date" disabled={busy} value={proposal.ct} onChange={(event) => setProposal({ ...proposal, ct: event.target.value })} className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-foreground" />
        </label>
        {isUtility ? <label className="block text-sm font-semibold">Échéance pollution lue
          <input type="date" disabled={busy} value={proposal.pollution} onChange={(event) => setProposal({ ...proposal, pollution: event.target.value })} className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-foreground" />
        </label> : null}
        <Button type="button" disabled={busy} onClick={() => {
          if (saving.current) return;
          saving.current = true;
          void (async () => {
            setBusy(true);
            try {
              const corrected = proposal.ct !== proposal.originalCt || proposal.pollution !== proposal.originalPollution;
              await persist(proposal.ct, proposal.pollution, undefined, corrected, proposal.ct || ctDate, proposal.pollution || pollutionDate);
              const ct = corrected ? proposal.ct : proposal.ct || ctDate;
              const pollution = corrected ? proposal.pollution : proposal.pollution || pollutionDate;
              setCtDate(ct);
              setPollutionDate(pollution);
              saved.current = { ct, pollution };
              setProposal(null);
              setReadMessage("Échéance confirmée et enregistrée.");
            } catch {
              toast.error("Échéance CT non enregistrée. Réessayez la confirmation.");
            } finally { setBusy(false); saving.current = false; }
          })();
        }}><Check /> Confirmer l’échéance</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setProposal(null)}>Ignorer la lecture</Button>
      </div> : null}
      <label className="block text-xs font-bold uppercase text-muted-foreground">
        Prochaine échéance CT
        <input
          type="date"
          disabled={busy}
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
        <input type="checkbox" disabled={busy} checked={isUtility} onChange={(event) => setIsUtility(event.target.checked)} />
        Véhicule utilitaire — contrôle pollution
      </label>
      {isUtility ? (
        <label className="block text-xs font-bold uppercase text-muted-foreground">
          Prochaine échéance pollution
          <input
            type="date"
            disabled={busy}
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
      <PhotoManager key={photoKey} compact captureEnabled={false} folder={`tours/${tourId}/controle-technique`} links={{ inspection_id: tourId, inspection_point_id: pointId }} />
    </div>
  );
}