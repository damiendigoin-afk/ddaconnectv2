import { useEffect, useRef, useState } from "react";
import { localDocText } from "@/lib/doc-text.browser";
import { Camera, Check, Images, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { PhotoManager } from "@/components/PhotoManager";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { CT_UNAVAILABLE_SOURCE, ctPersistValues, ctUnavailableNote, firstValidCtDate, mergeCtComment } from "@/lib/ct";
import { ocrTechnicalControl } from "@/lib/ocr.functions";
import { checkCtSave, ctSaveSource, CT_SOURCE_CORRECTED, type CtProvenance } from "@/lib/ct-ocr";
import { blobToDataUrl, compressImage, uploadPhoto } from "@/lib/photo";


type CtRead = {
  ct_due_date?: string | null;
  pollution_due_date?: string | null;
  vehicle_kind?: "vp" | "vu";
};

const fr = (d: string) => (d ? d.split("-").reverse().join("/") : "—");
const PATH_LABEL: Record<CtProvenance["path"], string> = {
  vision_photo: "lecture visuelle de la photo",
  regles_texte: "texte du document",
  ia_texte: "texte reconnu (sans la photo)",
  echec: "lecture impossible",
};

export function TechnicalControlCard({
  pointId,
  tourId,
  vehicleId,
  initialCt,
  initialPollution,
  gateRequest = 0,
  confirmed = true,
  actorName,
}: {
  pointId: string;
  tourId: string;
  vehicleId: string;
  initialCt?: string | null;
  initialPollution?: string | null;
  /** Incrémenté par le tour guidé quand l'opérateur tente de quitter la zone sans échéance confirmée. */
  gateRequest?: number;
  /** Échéance déjà confirmée explicitement sur ce point (ct_read_at). */
  confirmed?: boolean;
  actorName?: string | null;
}) {
  const gateRef = useRef<HTMLDivElement>(null);
  const [unavailableAsk, setUnavailableAsk] = useState(false);
  const gateOpen = gateRequest > 0 && !confirmed;
  useEffect(() => {
    if (gateRequest > 0 && !confirmed) gateRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [gateRequest, confirmed]);
  const input = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const readCtDocument = useServerFn(ocrTechnicalControl);
  // Date enregistrée (connue) et brouillon saisi : le brouillon n'est JAMAIS enregistré sans clic explicite.
  const [savedCt, setSavedCt] = useState(firstValidCtDate(initialCt) ?? "");
  const [ctDate, setCtDate] = useState(firstValidCtDate(initialCt) ?? "");
  const [pollutionDate, setPollutionDate] = useState(firstValidCtDate(initialPollution) ?? "");
  const [isUtility, setIsUtility] = useState(Boolean(initialPollution));
  const [busy, setBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  const [proposal, setProposal] = useState<{ ct: string; pollution: string; provenance: CtProvenance | null } | null>(null);
  const [lastOcr, setLastOcr] = useState<{ ct: string; provenance: CtProvenance | null } | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [confirmAsk, setConfirmAsk] = useState<{ ct: string; pollution: string; warnings: string[] } | null>(null);
  const [readMessage, setReadMessage] = useState("");
  const reading = useRef(false);
  const saving = useRef(false);

  useEffect(() => {
    if (reading.current || saving.current) return;
    const ct = firstValidCtDate(initialCt) ?? "";
    setSavedCt(ct);
    setCtDate(ct);
    setPollutionDate(firstValidCtDate(initialPollution) ?? "");
  }, [initialCt, initialPollution]);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

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
    setConfirmAsk(null);
    setReadMessage("");
    try { setPhotoUrl(URL.createObjectURL(file)); } catch { /* aperçu facultatif */ }
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
      // Photo : la vision lit l'image ; le texte local n'est qu'une aide secondaire.
      const text = await localDocText(dataUrl).catch(() => "");
      const result = await readCtDocument({ data: { text, dataUrl, filename: file.name } });
      const provenance = (result as { provenance?: CtProvenance }).provenance ?? null;
      if (!result.ok) {
        setLastOcr({ ct: "", provenance });
        setReadMessage("Photo enregistrée. Échéance non lue : saisissez la date du CT puis « Enregistrer cette date ».");
        return;
      }
      const parsed = JSON.parse(result.json) as CtRead;
      const readCt = firstValidCtDate(parsed.ct_due_date) ?? "";
      const readPollution = firstValidCtDate(parsed.pollution_due_date) ?? "";
      setLastOcr({ ct: readCt, provenance });
      if (parsed.vehicle_kind === "vu" || readPollution) setIsUtility(true);
      if (readCt || readPollution) setProposal({ ct: readCt, pollution: readPollution, provenance });
      setReadMessage(readCt ? "Date proposée par la lecture automatique — comparez avec la photo avant de confirmer." : "Photo enregistrée. Échéance CT non lue : date existante conservée, saisie manuelle possible.");
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

  async function persist(ct: string, pollution: string, source: string) {
    const values = ctPersistValues(ct, pollution, false);
    const now = new Date().toISOString();
    const corrected = source === CT_SOURCE_CORRECTED;
    const { data: current, error: commentError } = await supabase
      .from("inspection_points")
      .select("comment")
      .eq("id", pointId)
      .maybeSingle();
    if (commentError) throw commentError;
    const ocrMeta = lastOcr ? { ...(lastOcr.provenance ?? {}), proposed: Boolean(lastOcr.ct), final_differs: Boolean(lastOcr.ct) && lastOcr.ct !== ct } : null;
    const pointPatch = {
      ...values,
      ct_read_at: now,
      ct_source: source,
      ct_manually_corrected: corrected,
      ...(lastOcr ? { ct_ocr_date: lastOcr.ct || null, ct_ocr_meta: ocrMeta } : {}),
      comment: mergeCtComment(current?.comment ?? "", ct, pollution),
    };
    const vehiclePatch = { ...values, ct_read_at: now, ct_source: source, ct_manually_corrected: corrected };
    const [{ error: pointError }, { error: vehicleError }] = await Promise.all([
      supabase.from("inspection_points").update(pointPatch as never).eq("id", pointId),
      supabase.from("vehicles").update(vehiclePatch).eq("id", vehicleId),
    ]);
    if (pointError) throw pointError;
    if (vehicleError) throw vehicleError;
    await refresh();
  }

  async function commit(ct: string, pollution: string) {
    if (saving.current || reading.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const source = ctSaveSource({ finalCt: ct, ocrCt: lastOcr?.ct ?? null, existingCt: savedCt });
      await persist(ct, pollution, source);
      setSavedCt(ct);
      setCtDate(ct);
      setPollutionDate(pollution);
      setProposal(null);
      setConfirmAsk(null);
      setReadMessage(`Échéance du ${fr(ct)} enregistrée.`);
    } catch (error) {
      console.error(error);
      toast.error("Échéance CT non enregistrée. Vérifiez la connexion puis réessayez.");
    } finally { setBusy(false); saving.current = false; }
  }

  /** « Enregistrer cette date » : seul déclencheur d'enregistrement d'une saisie manuelle. */
  function requestSave(ct: string, pollution: string) {
    const check = checkCtSave({ finalCt: ct, ocrCt: lastOcr?.ct ?? null });
    if (!check.ok) { setReadMessage(check.error); return; }
    if (check.warnings.length) { setConfirmAsk({ ct, pollution, warnings: check.warnings }); return; }
    void commit(ct, pollution);
  }

  async function declareUnavailable() {
    if (saving.current || reading.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const { data: current, error: readError } = await supabase.from("inspection_points").select("comment").eq("id", pointId).maybeSingle();
      if (readError) throw readError;
      const now = new Date();
      const base = mergeCtComment(current?.comment ?? "", ctDate, pollutionDate);
      const note = ctUnavailableNote(actorName, now);
      // Dates existantes non effacées ; fiche véhicule non modifiée.
      const { error } = await supabase.from("inspection_points").update({
        ct_read_at: now.toISOString(),
        ct_source: CT_UNAVAILABLE_SOURCE,
        ct_manually_corrected: true,
        comment: `${note}\n${base}`,
      }).eq("id", pointId);
      if (error) throw error;
      setUnavailableAsk(false);
      setReadMessage("Échéance CT déclarée illisible / non disponible (tracé dans le commentaire).");
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error("Déclaration non enregistrée. Vérifiez la connexion puis réessayez.");
    } finally { setBusy(false); saving.current = false; }
  }

  return (
    <div className="space-y-3">
      {gateOpen ? (
        <div ref={gateRef} role="alert" className="space-y-2 rounded-xl border-2 border-status-defect bg-status-defect-soft p-3">
          <p className="text-sm font-extrabold uppercase text-status-defect">Échéance CT à confirmer avant de continuer</p>
          <p className="text-xs text-status-defect">La photo ou le statut OK ne suffisent pas : confirmez la date, saisissez-la ou déclarez-la illisible.</p>
          {proposal ? (
            <p className="text-sm font-semibold">Date proposée : {fr(proposal.ct)} — comparez avec la photo puis confirmez ci-dessous.</p>
          ) : firstValidCtDate(ctDate) ? (
            <Button type="button" disabled={busy} className="h-auto w-full whitespace-normal py-3 font-bold" onClick={() => requestSave(ctDate, pollutionDate)}>
              <Check /> Confirmer l’échéance CT du {fr(ctDate)}
            </Button>
          ) : (
            <p className="text-sm font-semibold">Aucune date lue : saisissez la date ci-dessous puis « Enregistrer cette date ».</p>
          )}
          {unavailableAsk ? (
            <div className="space-y-2 rounded-lg border-2 border-status-watch bg-card p-2">
              <p className="text-xs font-semibold">Attention : le tour continuera sans échéance CT. La déclaration sera tracée avec votre nom et la date.</p>
              <div className="flex gap-2">
                <Button type="button" variant="destructive" disabled={busy} onClick={() => void declareUnavailable()}>Confirmer : date illisible</Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setUnavailableAsk(false)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="outline" disabled={busy} className="h-auto w-full whitespace-normal py-2 text-xs" onClick={() => setUnavailableAsk(true)}>
              Date illisible / non disponible
            </Button>
          )}
        </div>
      ) : null}
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
      {confirmAsk ? (
        <div role="alertdialog" aria-label="Confirmer la date CT" className="space-y-2 rounded-xl border-2 border-status-watch bg-status-watch-soft p-3">
          {confirmAsk.warnings.map((w) => <p key={w} className="text-sm font-semibold">{w}</p>)}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button type="button" disabled={busy} className="h-auto whitespace-normal py-3 font-bold" onClick={() => void commit(confirmAsk.ct, confirmAsk.pollution)}>Oui, enregistrer le {fr(confirmAsk.ct)}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmAsk(null)}>Annuler</Button>
          </div>
        </div>
      ) : null}
      {proposal ? <div className="space-y-2 rounded-xl border-2 border-primary p-3" data-testid="ct-proposal">
        <div className="flex gap-3">
          {photoUrl ? <img src={photoUrl} alt="Photo du contrôle technique" className="h-28 w-28 shrink-0 rounded-lg border object-contain" /> : null}
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase text-muted-foreground">Date proposée (à vérifier sur la photo)</p>
            <p className="text-2xl font-extrabold">{fr(proposal.ct)}</p>
            {isUtility && proposal.pollution ? <p className="text-sm">Pollution : {fr(proposal.pollution)}</p> : null}
            {proposal.provenance ? <p className="text-xs text-muted-foreground">Source : {PATH_LABEL[proposal.provenance.path]}{proposal.provenance.confidence != null ? ` · confiance annoncée ${Math.round(proposal.provenance.confidence * 100)} %` : ""} — proposition, pas une preuve.</p> : null}
          </div>
        </div>
        {proposal.ct ? <Button type="button" disabled={busy} className="h-auto w-full whitespace-normal py-3 font-bold" onClick={() => requestSave(proposal.ct, proposal.pollution || pollutionDate)}>
          <Check /> Confirmer le {fr(proposal.ct)} (lu sur la photo)
        </Button> : null}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setProposal(null)}>La date est fausse : je la corrige ci-dessous</Button>
      </div> : null}
      <div className="space-y-2 rounded-xl border-2 border-border p-3">
        <label className="block text-xs font-bold uppercase text-muted-foreground">
          Prochaine échéance CT {savedCt ? `(enregistrée : ${fr(savedCt)})` : "(aucune enregistrée)"}
          <input
            type="date"
            disabled={busy}
            value={ctDate}
            onChange={(event) => setCtDate(event.target.value)}
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
            <input type="date" disabled={busy} value={pollutionDate} onChange={(event) => setPollutionDate(event.target.value)} className="mt-1 w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-foreground" />
          </label>
        ) : null}
        <Button type="button" variant="outline" disabled={busy || !ctDate} className="h-auto w-full whitespace-normal py-3 font-bold" onClick={() => requestSave(ctDate, isUtility ? pollutionDate : "")}>
          Enregistrer cette date
        </Button>
        <p className="text-xs text-muted-foreground">Le calendrier seul n’enregistre rien : vérifiez la date puis appuyez sur « Enregistrer cette date ».</p>
      </div>
      <PhotoManager key={photoKey} compact captureEnabled={false} folder={`tours/${tourId}/controle-technique`} links={{ inspection_id: tourId, inspection_point_id: pointId }} />
    </div>
  );
}