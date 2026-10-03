import { useEffect, useRef, useState } from "react";
import { DRAG_START_PX, adjustDepth, wearLevel } from "@/lib/tire-step";

type Vals = [number | null, number | null, number | null];

/** Valeurs mm superposées sur la vraie photo de bande de roulement (gauche / milieu / droite de l'image).
 *  Glisser verticalement une valeur l'ajuste par pas de 0,1 mm (haut = +, bas = −). */
export function TireTreadOverlay({ src, values, labels, onAdjust }: { src: string; values: Vals; labels: [string, string, string]; onAdjust?: (i: number, v: number) => void }) {
  const tone = (v: number | null) => {
    const l = wearLevel(v);
    return l === "critique" ? "bg-destructive text-background" : l === "surveiller" ? "bg-warning text-foreground" : l === "bon" ? "bg-success text-background" : "bg-muted text-muted-foreground";
  };
  const line = (v: number | null) => {
    const l = wearLevel(v);
    return l === "critique" ? "bg-destructive" : l === "surveiller" ? "bg-warning" : l === "bon" ? "bg-success" : "bg-muted-foreground";
  };
  const xs = ["16.7%", "50%", "83.3%"];
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border-2 border-border">
        <img src={src} alt="Bande de roulement analysée" className="block max-h-[420px] w-full object-cover" />
        {values.map((v, i) => (
          <div key={i} className="pointer-events-none absolute top-0 flex h-full -translate-x-1/2 flex-col items-center" style={{ left: xs[i] }}>
            <DragBadge value={v} className={tone(v)} label={labels[i]} onChange={onAdjust ? (n) => onAdjust(i, n) : undefined} />
            <div className={`w-1 flex-1 opacity-80 ${line(v)}`} />
            <div className={`mb-2 h-4 w-4 rounded-full border-2 border-background ${line(v)}`} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-destructive" /> ≤ 1,6 mm</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-warning" /> 1,6 – 3 mm</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-success" /> ≥ 3 mm</span>
        {onAdjust && <span>↕ glisser une valeur : ±0,1 mm</span>}
      </div>
    </div>
  );
}

function DragBadge({ value, label, className, onChange }: { value: number | null; label: string; className: string; onChange?: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const live = useRef({ value, onChange });
  live.current = { value, onChange };

  useEffect(() => {
    const el = ref.current;
    if (!el || !onChange) return;
    let g: { y: number; start: number | null; engaged: boolean } | null = null;
    const begin = (y: number) => { g = { y, start: live.current.value, engaged: false }; };
    // Retourne true si l'ajustement est engagé (le défilement doit alors être bloqué).
    const move = (y: number) => {
      if (!g) return false;
      const dy = y - g.y;
      if (!g.engaged) {
        if (Math.abs(dy) < DRAG_START_PX) return false;
        g.engaged = true; g.y = y; setActive(true);
        return true;
      }
      const next = adjustDepth(g.start, dy);
      if (next !== live.current.value) live.current.onChange?.(next);
      return true;
    };
    const end = () => { g = null; setActive(false); };

    const ts = (e: TouchEvent) => { if (e.touches.length === 1) begin(e.touches[0]!.clientY); else end(); };
    const tm = (e: TouchEvent) => { if (e.touches.length === 1 && move(e.touches[0]!.clientY) && e.cancelable) e.preventDefault(); };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);

    // Souris (desktop) via Pointer Events.
    const pd = (e: PointerEvent) => { if (e.pointerType !== "mouse") return; e.preventDefault(); begin(e.clientY); el.setPointerCapture(e.pointerId); };
    const pm = (e: PointerEvent) => { if (e.pointerType === "mouse") move(e.clientY); };
    const pu = (e: PointerEvent) => { if (e.pointerType === "mouse") end(); };
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("pointercancel", pu);
    return () => {
      el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm);
      el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end);
      el.removeEventListener("pointerdown", pd); el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu); el.removeEventListener("pointercancel", pu);
    };
  }, [!!onChange]);

  return (
    <div
      ref={ref}
      role={onChange ? "slider" : undefined}
      aria-label={onChange ? `${label} : glisser verticalement pour ajuster de 0,1 mm` : undefined}
      aria-valuenow={value ?? undefined}
      aria-valuemin={0}
      aria-valuemax={12}
      className={`pointer-events-auto mt-2 select-none rounded-lg px-2 py-1 text-center shadow-lg transition-transform ${onChange ? "cursor-ns-resize" : ""} ${active ? "scale-110 ring-2 ring-background" : ""} ${className}`}
    >
      <div className="text-[10px] font-bold uppercase leading-none">{label}{onChange ? " ↕" : ""}</div>
      <div className="text-lg font-extrabold leading-tight">{value === null ? "—" : `${value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`}</div>
    </div>
  );
}
