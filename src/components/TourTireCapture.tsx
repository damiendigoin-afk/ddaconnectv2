import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BurstCamera, type BurstShot } from "./BurstCamera";
import { PhotoManager } from "./PhotoManager";
import { uploadPhoto } from "@/lib/photo";
import { supabase } from "@/integrations/supabase/client";
import { isTirePressureChecked, TIRE_PRESSURE_LABEL } from "@/lib/tour-tire-pressure";
import { saveTourTirePressureChecked } from "@/lib/tour-tire-persistence";
import type { PointRow } from "./PointCard";

const STEPS = [
  { key: "bande", label: "Bande de roulement", mask: "tread" as const, hint: "Cadrez la bande de roulement dans le U, avec les deux bords du pneu visibles" },
  { key: "flanc", label: "Flanc", mask: "sidewall" as const, hint: "Cadrez le flanc du pneu dans le cercle" },
  { key: "dimension", label: "Dimension pneu", mask: "tire-chars" as const, hint: "Cadrez la dimension et les indices" },
];

type TireCapturePoint = PointRow & { tire_analysis?: unknown };

export function TourTireCapture({ point, inspectionId, onCaptured }: { point: TireCapturePoint; inspectionId: string; onCaptured?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [key, setKey] = useState(0);
  const [pressureChecked, setPressureChecked] = useState(() => isTirePressureChecked(point.tire_analysis));
  const [pressureSaving, setPressureSaving] = useState(false);
  const [pressureError, setPressureError] = useState("");

  useEffect(() => {
    setPressureChecked(isTirePressureChecked(point.tire_analysis));
  }, [point.tire_analysis]);

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
      setPressureChecked(checked);
      onCaptured?.();
      toast.success(checked ? "Pression confirmée pour cette roue" : "Pression marquée comme non confirmée");
    } catch (e) {
      console.error(e);
      setPressureError("La confirmation de pression n’a pas été enregistrée. Réessayez.");
      toast.error("Pression non enregistrée. Réessayez.");
    } finally {
      setPressureSaving(false);
    }
  }

  return <div className="card-surface space-y-3 p-4" data-testid={`tire-capture-${point.point_key}`}>
    <div className="flex items-center justify-between"><h3 className="font-bold">{point.point_label}</h3>{done ? <span className="flex items-center gap-1 text-xs font-bold text-success"><CheckCircle2 className="h-4 w-4"/> Prêt</span> : null}</div>
    <p className="text-xs text-muted-foreground">Bande · Flanc · Dimension. L’analyse des quatre roues sera lancée ensemble à la fin.</p>
    <button type="button" disabled={busy} onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50">
      {busy ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="h-5 w-5"/>}{done ? "Reprendre les 3 photos" : "Photographier le pneu (3 photos)"}
    </button>
    <div className="rounded-xl border-2 border-border bg-card px-3 py-2">
      <label className="flex cursor-pointer items-start gap-3 text-sm font-semibold">
        <input
          type="checkbox"
          checked={pressureChecked}
          disabled={pressureSaving}
          aria-label={`${TIRE_PRESSURE_LABEL} — ${point.point_label}`}
          onChange={(e) => void savePressure(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span>{TIRE_PRESSURE_LABEL}</span>
      </label>
      <p className="mt-1 pl-8 text-xs text-muted-foreground">Facultatif — décoché signifie « non confirmé ».</p>
    </div>
    {pressureError ? <p role="alert" className="text-xs font-bold text-destructive">{pressureError}</p> : null}
    <PhotoManager key={key} compact folder={`inspections/${inspectionId}`} links={{ inspection_id: inspectionId, inspection_point_id: point.id }}/>
    {open ? <BurstCamera title={point.point_label} steps={STEPS} allowFree={false} autoFinish onFinish={(s) => void save(s)} onCancel={() => setOpen(false)}/> : null}
  </div>;
}
