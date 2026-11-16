import { Camera, CheckCircle2, CloudOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BurstCamera, type BurstShot } from "./BurstCamera";
import { PhotoManager } from "./PhotoManager";
import { uploadPhoto } from "@/lib/photo";
import { supabase } from "@/integrations/supabase/client";
import { tirePressureState, TIRE_PRESSURE_LABEL, type TirePressureState } from "@/lib/tour-tire-pressure";
import { flushPendingTirePressure, pendingTirePressure, queueTirePressure, saveTourTirePressureChecked } from "@/lib/tour-tire-persistence";
import type { PointRow } from "./PointCard";

const STEPS = [
  { key: "bande", label: "Bande de roulement", mask: "tread" as const, hint: "Cadrez la bande de roulement dans le U, avec les deux bords du pneu visibles" },
  { key: "flanc", label: "Flanc", mask: "sidewall" as const, hint: "Cadrez le flanc du pneu dans le cercle" },
  { key: "dimension", label: "Dimension pneu", mask: "tire-chars" as const, hint: "Cadrez la dimension et les indices" },
];

type TireCapturePoint = PointRow & { tire_analysis?: unknown };

function stateFor(point: TireCapturePoint): TirePressureState {
  const pending = pendingTirePressure(point.id);
  if (pending !== undefined) return pending ? "checked" : "unchecked";
  return tirePressureState(point.tire_analysis);
}

export function TourTireCapture({ point, inspectionId, onCaptured }: { point: TireCapturePoint; inspectionId: string; onCaptured?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [key, setKey] = useState(0);
  const [pressure, setPressure] = useState<TirePressureState>(() => tirePressureState(point.tire_analysis));
  const [queued, setQueued] = useState(false);
  const [pressureSaving, setPressureSaving] = useState(false);
  const [pressureError, setPressureError] = useState("");

  useEffect(() => {
    setPressure(stateFor(point));
    setQueued(pendingTirePressure(point.id) !== undefined);
  }, [point.tire_analysis, point.id]);

  useEffect(() => {
    const flush = () => void flushPendingTirePressure().then((n) => {
      if (n > 0) { setQueued(pendingTirePressure(point.id) !== undefined); onCaptured?.(); }
    });
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.id]);

  async function save(shots: BurstShot[]) {
    setOpen(false);
    if (shots.length !== 3) { toast.error("Trois photos sont requises pour cette roue."); return; }
    setBusy(true);
    try {
      for (const shot of shots) await uploadPhoto(shot.blob, `inspections/${inspectionId}`, { inspection_id: inspectionId, inspection_point_id: point.id, label: shot.label });
      await supabase.from("inspection_points").update({ status: "ok", updated_at: new Date().toISOString() }).eq("id", point.id);
      setDone(true); setKey((v) => v + 1); onCaptured?.(); toast.success("3 photos enregistrées — analyse à la fin du tour");
    } catch (e) { console.error(e); toast.error("Photos non enregistrées. Réessayez."); } finally { setBusy(false); }
  }

  async function savePressure(checked: boolean) {
    if (pressureSaving) return;
    setPressureSaving(true);
    setPressureError("");
    try {
      await saveTourTirePressureChecked(point.id, checked);
      setPressure(checked ? "checked" : "unchecked");
      setQueued(false);
      onCaptured?.();
      toast.success(checked ? "Pression contrôlée — enregistré pour cette roue" : "Pression non contrôlée — enregistré pour cette roue");
    } catch (e) {
      console.error(e);
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      if (offline) {
        // Hors réseau : réponse gardée sur l'appareil pour CETTE roue, envoyée au retour du réseau.
        queueTirePressure(point.id, checked);
        setPressure(checked ? "checked" : "unchecked");
        setQueued(true);
        onCaptured?.();
      } else {
        setPressureError("La réponse sur la pression n’a pas été enregistrée. Réessayez.");
        toast.error("Pression non enregistrée. Réessayez.");
      }
    } finally {
      setPressureSaving(false);
    }
  }

  const choice = (checked: boolean, label: string) => {
    const active = pressure === (checked ? "checked" : "unchecked");
    return <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={pressureSaving}
      onClick={() => void savePressure(checked)}
      className={`min-h-14 rounded-xl border-2 px-3 py-3 text-base font-extrabold disabled:opacity-60 ${active ? (checked ? "border-success bg-success/15 text-foreground ring-2 ring-success" : "border-foreground bg-foreground text-background") : "border-border bg-background text-foreground"}`}
    >{label}</button>;
  };

  return <div className="card-surface space-y-3 p-4" data-testid={`tire-capture-${point.point_key}`}>
    <div className="flex items-center justify-between"><h3 className="font-bold">{point.point_label}</h3>{done ? <span className="flex items-center gap-1 text-xs font-bold text-success"><CheckCircle2 className="h-4 w-4"/> Prêt</span> : null}</div>
    <p className="text-xs text-muted-foreground">Bande · Flanc · Dimension. L’analyse des quatre roues sera lancée ensemble à la fin.</p>
    <button type="button" disabled={busy} onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50">
      {busy ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="h-5 w-5"/>}{done ? "Reprendre les 3 photos" : "Photographier le pneu (3 photos)"}
    </button>
    <fieldset className={`space-y-2 rounded-xl border-4 p-3 ${pressure === "unset" ? "border-status-watch bg-status-watch-soft" : "border-border bg-card"}`} data-testid={`tire-pressure-${point.point_key}`}>
      <legend className="px-1 text-base font-extrabold">Pression des pneus — {point.point_label}</legend>
      <p className="text-sm font-semibold">{TIRE_PRESSURE_LABEL} ?</p>
      <div role="radiogroup" aria-label={`Pression — ${point.point_label}`} className="grid grid-cols-2 gap-2">
        {choice(true, "Pression contrôlée")}
        {choice(false, "Non contrôlée")}
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {pressureSaving ? "Enregistrement…" : pressure === "unset" ? "Non renseignée — choisissez une réponse (« Non contrôlée » est accepté)." : pressure === "checked" ? "Réponse enregistrée : pression contrôlée (déclaration, aucune valeur mesurée)." : "Réponse enregistrée : pression non contrôlée."}
      </p>
      {queued ? <p className="flex items-center gap-1 text-xs font-bold text-status-watch"><CloudOff className="h-4 w-4"/> Hors réseau : réponse gardée sur l’appareil, envoyée dès le retour du réseau.</p> : null}
    </fieldset>
    {pressureError ? <p role="alert" className="text-xs font-bold text-destructive">{pressureError}</p> : null}
    <PhotoManager key={key} compact folder={`inspections/${inspectionId}`} links={{ inspection_id: inspectionId, inspection_point_id: point.id }}/>
    {open ? <BurstCamera title={point.point_label} steps={STEPS} allowFree={false} autoFinish onFinish={(s) => void save(s)} onCancel={() => setOpen(false)}/> : null}
  </div>;
}
