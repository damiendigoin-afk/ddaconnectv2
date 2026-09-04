import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { PhotoManager } from "@/components/PhotoManager";
import { StatusPicker, type PointStatus } from "@/components/StatusPicker";
import { BatteryTestCard, type BatteryTest } from "@/components/BatteryTestCard";
import { uploadPhoto } from "@/lib/photo";
import type { PointDef } from "@/lib/zones";

export type PointRow = {
  id: string;
  point_key: string;
  point_label: string;
  status: string;
  measure_value: string | null;
  measure_unit: string | null;
  comment: string | null;
};

export function PointCard({
  point,
  def,
  inspectionId,
  onChanged,
}: {
  point: PointRow;
  def?: PointDef | undefined;
  inspectionId: string;
  onChanged?: ((status: PointStatus) => void) | undefined;
}) {
  const [status, setStatus] = useState<PointStatus>(point.status as PointStatus);
  const [measure, setMeasure] = useState(point.measure_value ?? "");
  const [comment, setComment] = useState(point.comment ?? "");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function persist(patch: Record<string, unknown>) {
    await supabase
      .from("inspection_points")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", point.id);
  }

  function debounced(patch: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(patch), 500);
  }

  async function onShots(shots: BurstShot[]) {
    setCameraOpen(false);
    if (!shots.length) return;
    setUploading(true);
    // Flux photo partagé : normalisation Android + envoi protégé, jamais d'exception.
    let sent = 0;
    let failure: string | null = null;
    for (const shot of shots) {
      const res = await uploadCapture(shot?.blob, `inspections/${inspectionId}`, {
        inspection_id: inspectionId,
        inspection_point_id: point.id,
      });
      if (res.ok) sent += 1;
      else failure = res.message;
    }
    setUploading(false);
    if (sent > 0) {
      toast.success(sent > 1 ? "Photos enregistrées" : "Photo enregistrée");
      setPhotoKey((k) => k + 1);
    }
    if (failure) toast.error(failure);
  }

  const flagged = status === "watch" || status === "defect";
  const isBattery = /batterie/.test(point.point_key);

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold">{point.point_label}</h3>
        {status === "unset" ? (
          <span className="text-xs font-semibold text-muted-foreground">Non renseigné</span>
        ) : null}
      </div>
      <StatusPicker
        value={status}
        onChange={(v) => {
          setStatus(v);
          onChanged?.(v);
          void persist({ status: v });
        }}
      />
      {isBattery ? (
        <BatteryTestCard
          pointId={point.id}
          inspectionId={inspectionId}
          initial={(point as unknown as { battery_test?: BatteryTest | null }).battery_test ?? null}
        />
      ) : null}
      {def?.quickDefects && (status === "watch" || status === "defect") ? (
        <div className="flex flex-wrap gap-2">
          {def.quickDefects.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                const next = comment.includes(d)
                  ? comment
                  : [comment.trim(), d].filter(Boolean).join(" · ");
                setComment(next);
                void persist({ comment: next });
              }}
              className={`rounded-full border-2 px-3 py-2 text-xs font-bold ${
                comment.includes(d) ? "border-brand bg-brand/10" : "border-border bg-card"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      ) : null}
      {def?.measure ? (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">{def.measure.label}</span>
          <input
            inputMode="decimal"
            value={measure}
            onChange={(e) => {
              setMeasure(e.target.value);
              debounced({ measure_value: e.target.value, measure_unit: def.measure!.unit });
            }}
            className="w-24 rounded-lg border-2 border-border px-2 py-2 text-center text-base outline-none focus:border-brand"
          />
          <span className="text-sm font-semibold">{def.measure.unit}</span>
        </div>
      ) : null}
      <textarea
        value={comment}
        placeholder="Commentaire (facultatif)"
        rows={2}
        onChange={(e) => {
          setComment(e.target.value);
          debounced({ comment: e.target.value });
        }}
        className="w-full rounded-lg border-2 border-border px-3 py-2 text-sm outline-none focus:border-brand"
      />
      {flagged ? (
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-status-defect px-4 py-4 text-base font-extrabold uppercase text-white disabled:opacity-60"
        >
          <Camera className="h-5 w-5" /> {uploading ? "Envoi…" : "Photo(s)"}
        </button>
      ) : null}
      <PhotoManager
        key={photoKey}
        compact
        folder={`inspections/${inspectionId}`}
        links={{ inspection_id: inspectionId, inspection_point_id: point.id }}
      />
      {cameraOpen ? (
        <BurstCamera
          steps={[]}
          allowFree={false}
          title={point.point_label}
          onFinish={(shots) => void onShots(shots)}
          onCancel={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}
