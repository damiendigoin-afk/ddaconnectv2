import { useEffect, useRef, useState } from "react";
import { Check, Eraser, Undo2, X } from "lucide-react";

import type { Annotation } from "@/lib/expertise";

type Pt = { x: number; y: number };

/**
 * Entourer le dommage au doigt directement sur la photo.
 * Retourne l'image annotée (utilisée pour le rapport) + le tracé normalisé.
 */
export function PhotoAnnotator({
  src,
  number,
  onCancel,
  onValidate,
}: {
  src: string;
  number: number;
  onCancel: () => void;
  onValidate: (annotated: Blob, annotation: Annotation) => void;
}) {
  const [paths, setPaths] = useState<Pt[][]>([]);
  const [current, setCurrent] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setPaths([]);
    setCurrent([]);
  }, [src]);

  function pointFrom(e: React.PointerEvent) {
    const rect = boxRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  const all = current.length ? [...paths, current] : paths;

  async function validate() {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const unit = Math.max(canvas.width, canvas.height);
      ctx.strokeStyle = "#ff2d2d";
      ctx.lineWidth = Math.max(4, unit * 0.006);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const path of all) {
        if (path.length < 2) continue;
        ctx.beginPath();
        path.forEach((p, i) => {
          const x = p.x * canvas.width;
          const y = p.y * canvas.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      const anchor = all[0]?.[0];
      if (anchor) {
        const r = Math.max(16, unit * 0.028);
        const cx = anchor.x * canvas.width;
        const cy = Math.max(r, anchor.y * canvas.height - r);
        ctx.fillStyle = "#ff2d2d";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${Math.round(r * 1.25)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(number), cx, cy + r * 0.05);
      }
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, "image/jpeg", 0.9),
      );
      if (blob) onValidate(blob, { number, path: all.flat() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Entourez le dommage avec le doigt sur la photo. Le repère n°{number} sera ajouté
        automatiquement.
      </p>
      <div
        ref={boxRef}
        className="relative touch-none select-none overflow-hidden rounded-xl border-2 border-border bg-card"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setCurrent([pointFrom(e)]);
        }}
        onPointerMove={(e) => {
          if (!current.length) return;
          e.preventDefault();
          setCurrent((p) => [...p, pointFrom(e)]);
        }}
        onPointerUp={() => {
          if (current.length > 1) setPaths((p) => [...p, current]);
          setCurrent([]);
        }}
        onPointerCancel={() => {
          if (current.length > 1) setPaths((p) => [...p, current]);
          setCurrent([]);
        }}
      >
        <img ref={imgRef} src={src} alt="Photo du dommage" crossOrigin="anonymous" className="block w-full" />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {all.map((path, i) => (
            <polyline
              key={i}
              points={path.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
              fill="none"
              stroke="#ff2d2d"
              strokeWidth={4}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-border bg-card px-2 py-3 text-xs font-bold uppercase"
        >
          <X className="h-4 w-4" /> Annuler
        </button>
        <button
          type="button"
          onClick={() => setPaths((p) => p.slice(0, -1))}
          disabled={!paths.length}
          className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-border bg-card px-2 py-3 text-xs font-bold uppercase disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" /> Annuler tracé
        </button>
        <button
          type="button"
          onClick={() => {
            setPaths([]);
            setCurrent([]);
          }}
          className="flex items-center justify-center gap-1.5 rounded-lg border-2 border-border bg-card px-2 py-3 text-xs font-bold uppercase"
        >
          <Eraser className="h-4 w-4" /> Effacer
        </button>
        <button
          type="button"
          disabled={busy || !all.length}
          onClick={() => void validate()}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-brand px-2 py-3 text-xs font-bold uppercase text-brand-foreground disabled:opacity-60"
        >
          <Check className="h-4 w-4" /> Valider
        </button>
      </div>
    </div>
  );
}