import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BurstCamera, type BurstShot } from "./BurstCamera";
import { PhotoManager } from "./PhotoManager";
import { uploadPhoto } from "@/lib/photo";
import { supabase } from "@/integrations/supabase/client";
import type { PointRow } from "./PointCard";

const STEPS = [
  { key: "bande", label: "Bande de roulement", mask: "tread" as const, hint: "Cadrez la bande de roulement dans le U, avec les deux bords du pneu visibles" },
  { key: "flanc", label: "Flanc", mask: "sidewall" as const, hint: "Cadrez le flanc du pneu dans le cercle" },
  { key: "dimension", label: "Dimension pneu", mask: "tire-chars" as const, hint: "Cadrez la dimension et les indices" },
];

export function TourTireCapture({ point, inspectionId, onCaptured }: { point: PointRow; inspectionId: string; onCaptured?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [key, setKey] = useState(0);
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
  return <div className="card-surface space-y-3 p-4">
    <div className="flex items-center justify-between"><h3 className="font-bold">{point.point_label}</h3>{done ? <span className="flex items-center gap-1 text-xs font-bold text-success"><CheckCircle2 className="h-4 w-4"/> Prêt</span> : null}</div>
    <p className="text-xs text-muted-foreground">Bande · Flanc · Dimension. L’analyse des quatre roues sera lancée ensemble à la fin.</p>
    <button type="button" disabled={busy} onClick={() => setOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50">
      {busy ? <Loader2 className="h-5 w-5 animate-spin"/> : <Camera className="h-5 w-5"/>}{done ? "Reprendre les 3 photos" : "Photographier le pneu (3 photos)"}
    </button>
    <PhotoManager key={key} compact folder={`inspections/${inspectionId}`} links={{ inspection_id: inspectionId, inspection_point_id: point.id }}/>
    {open ? <BurstCamera title={point.point_label} steps={STEPS} allowFree={false} autoFinish onFinish={(s) => void save(s)} onCancel={() => setOpen(false)}/> : null}
  </div>;
}