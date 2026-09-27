/** Synthèse compacte éditable d'un pneu : un seul bouton « Confirmer le pneu ». */
import { Check } from "lucide-react";
import { useState } from "react";

import type { TireConfirmFields } from "@/lib/tire-ocr-parse";

export function TireConfirmPanel({
  initial,
  depthText,
  confirmed,
  onConfirm,
}: {
  initial: TireConfirmFields;
  depthText: string;
  confirmed: boolean;
  onConfirm: (f: TireConfirmFields) => void;
}) {
  const [f, setF] = useState<TireConfirmFields>(initial);
  const [depthStr, setDepthStr] = useState(initial.depth != null ? String(initial.depth) : "");
  const input = "w-full rounded-md border-2 border-border bg-background px-2 py-1.5 text-sm font-semibold uppercase";
  const txt = (label: string, key: "size" | "load" | "speed" | "brand" | "model", ph: string) => (
    <label className="block">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <input className={input} value={f[key] ?? ""} placeholder={ph} onChange={(e) => setF({ ...f, [key]: e.target.value || null })} />
    </label>
  );
  const flag = (label: string, key: "xl" | "runflat" | "ms" | "pmsf") => (
    <label className="flex items-center gap-1 text-xs font-semibold">
      <input type="checkbox" checked={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div className="space-y-2 rounded-xl border-2 border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-extrabold uppercase tracking-widest">Synthèse du pneu</span>
        <span className="text-xs text-muted-foreground">{depthText}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Profondeur (mm)</span>
          <input className={input} inputMode="decimal" value={depthStr} placeholder="mm" onChange={(e) => setDepthStr(e.target.value)} />
        </label>
        {txt("Dimension", "size", "155/65 R14")}
        {txt("Charge", "load", "75")}
        {txt("Vitesse", "speed", "T")}
        {txt("Marque", "brand", "—")}
        {txt("Modèle", "model", "—")}
        <label className="block">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Saison</span>
          <select className={input} value={f.season ?? ""} onChange={(e) => setF({ ...f, season: (e.target.value || null) as TireConfirmFields["season"] })}>
            <option value="">—</option>
            <option value="ete">Été</option>
            <option value="quatre_saisons">4 saisons</option>
            <option value="hiver">Hiver</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        {flag("XL", "xl")}
        {flag("Runflat", "runflat")}
        {flag("M+S", "ms")}
        {flag("3PMSF", "pmsf")}
      </div>
      <button
        type="button"
        onClick={() => {
          const n = Number(depthStr.replace(",", ".").trim());
          onConfirm({ ...f, depth: depthStr.trim() && Number.isFinite(n) ? n : null });
        }}
        className="flex w-full items-center justify-center gap-1 rounded-lg bg-status-ok px-3 py-3 text-xs font-extrabold uppercase text-primary-foreground"
      >
        <Check className="h-4 w-4" /> {confirmed ? "Pneu confirmé — mettre à jour" : "Confirmer le pneu"}
      </button>
    </div>
  );
}
