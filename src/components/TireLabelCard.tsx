/**
 * Étape « Étiquette dimensions et pressions pneumatiques » du Tour Véhicule.
 *
 * Photo prise au montant de porte conducteur. Les valeurs lues servent à
 * contrôler la monte, repérer les différences avant/arrière et préparer les
 * devis, sans être considérées comme l'unique preuve des dimensions homologuées.
 */
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BurstCamera, type BurstShot } from "@/components/BurstCamera";
import { PhotoManager } from "@/components/PhotoManager";
import type { PointRow } from "@/components/PointCard";
import { supabase } from "@/integrations/supabase/client";
import { blobToDataUrl, compressImage, uploadPhoto } from "@/lib/photo";
import { analyzeTireLabelPhoto } from "@/lib/tire-ai.functions";
import type { TireLabelAi } from "@/lib/tire-types";

const STEP = [
  {
    key: "etiquette_pneus",
    label: "Étiquette dimensions et pressions",
    mask: "tire-label" as const,
    hint: "Cadrez l'étiquette du montant de porte conducteur",
  },
];

type State = "photographiee" | "introuvable" | "illisible" | null;

export function TireLabelCard({
  point,
  inspectionId,
  onLabel,
}: {
  point: PointRow & { tire_label?: unknown };
  inspectionId: string;
  onLabel?: (label: TireLabelAi | null) => void;
}) {
  const analyze = useServerFn(analyzeTireLabelPhoto);
  const initial = (point.tire_label ?? null) as { state?: State; label?: TireLabelAi | null } | null;

  const [state, setState] = useState<State>(initial?.state ?? null);
  const [label, setLabel] = useState<TireLabelAi | null>(initial?.label ?? null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);

  async function save(next: { state: State; label: TireLabelAi | null }) {
    setState(next.state);
    setLabel(next.label);
    onLabel?.(next.label);
    await supabase
      .from("inspection_points")
      .update({
        tire_label: next as never,
        status: next.state === "photographiee" ? "ok" : "watch",
        comment:
          next.state === "introuvable"
            ? "Étiquette introuvable — vérifier également la trappe à carburant"
            : next.state === "illisible"
              ? "Étiquette illisible"
              : point.comment,
        updated_at: new Date().toISOString(),
      })
      .eq("id", point.id);
  }

  async function onShots(shots: BurstShot[]) {
    setCameraOpen(false);
    if (!shots.length) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const shot of shots) {
        await uploadPhoto(shot.blob, `inspections/${inspectionId}`, {
          inspection_id: inspectionId,
          inspection_point_id: point.id,
          label: shot.label,
        });
        const small = await compressImage(shot.blob, 1400, 0.8);
        urls.push(await blobToDataUrl(small));
      }
      setPhotoKey((k) => k + 1);
      const res = await analyze({ data: { images: urls.slice(0, 3) } });
      if (!res.ok || !res.json) {
        toast.error(res.error || "Lecture impossible — saisie manuelle possible.");
        await save({ state: "illisible", label: null });
        return;
      }
      const parsed = JSON.parse(res.json) as TireLabelAi;
      await save({ state: parsed.readable ? "photographiee" : "illisible", label: parsed });
      toast.success(parsed.readable ? "Étiquette enregistrée" : "Étiquette photographiée mais illisible");
    } catch (e) {
      console.error(e);
      toast.error("Échec de l'enregistrement de l'étiquette");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string | null][] = [
    ["Dimension avant", label?.size_front ?? null],
    ["Dimension arrière", label?.size_rear ?? null],
    [
      "Indices avant",
      [label?.load_index_front, label?.speed_index_front].filter(Boolean).join(" ") || null,
    ],
    ["Pression avant", label?.pressure_front != null ? `${label.pressure_front} bar` : null],
    ["Pression arrière", label?.pressure_rear != null ? `${label.pressure_rear} bar` : null],
    [
      "Pression avant en charge",
      label?.pressure_front_loaded != null ? `${label.pressure_front_loaded} bar` : null,
    ],
    [
      "Pression arrière en charge",
      label?.pressure_rear_loaded != null ? `${label.pressure_rear_loaded} bar` : null,
    ],
    ["Roue de secours", label?.spare_size ?? null],
  ];

  return (
    <div className="card-surface space-y-3 p-4">
      <h3 className="font-bold">{point.point_label}</h3>
      <p className="text-xs text-muted-foreground">
        Étiquette du montant de porte conducteur : dimensions, indices de charge et de vitesse,
        pressions avant / arrière, pressions en charge et roue de secours.
      </p>

      <button
        type="button"
        onClick={() => setCameraOpen(true)}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
        {busy ? "Lecture…" : "Photographier l'étiquette"}
      </button>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void save({ state: "introuvable", label: null })}
          className={`rounded-lg border-2 px-3 py-2 text-xs font-bold uppercase ${
            state === "introuvable" ? "border-brand bg-brand/10" : "border-border"
          }`}
        >
          Étiquette introuvable
        </button>
        <button
          type="button"
          onClick={() => void save({ state: "illisible", label })}
          className={`rounded-lg border-2 px-3 py-2 text-xs font-bold uppercase ${
            state === "illisible" ? "border-brand bg-brand/10" : "border-border"
          }`}
        >
          Étiquette illisible
        </button>
      </div>

      {state === "introuvable" ? (
        <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-950">
          Pensez à vérifier la trappe à carburant.
        </p>
      ) : null}

      {label ? (
        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-secondary px-3 py-2 text-xs">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] font-bold uppercase text-muted-foreground">{k}</dt>
              <dd className="font-semibold">{v ?? "Non lisible"}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <PhotoManager
        key={photoKey}
        compact
        folder={`inspections/${inspectionId}`}
        links={{ inspection_id: inspectionId, inspection_point_id: point.id }}
      />

      {cameraOpen ? (
        <BurstCamera
          steps={STEP}
          allowFree={false}
          autoFinish
          title="Étiquette pneumatiques"
          onFinish={(shots) => void onShots(shots)}
          onCancel={() => setCameraOpen(false)}
        />
      ) : null}
    </div>
  );
}
