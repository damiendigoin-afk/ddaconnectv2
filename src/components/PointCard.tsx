import { useEffect, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { PhotoManager } from "@/components/PhotoManager";
import { StatusPicker, type PointStatus } from "@/components/StatusPicker";
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
      <PhotoManager
        compact
        folder={`inspections/${inspectionId}`}
        links={{ inspection_id: inspectionId, inspection_point_id: point.id }}
      />
    </div>
  );
}