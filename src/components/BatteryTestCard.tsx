/**
 * Test batterie : photo du ticket du testeur, lecture automatique des valeurs,
 * puis correction humaine possible. Rien n'est déduit : une valeur non lue
 * reste vide et le verdict n'est jamais inventé.
 */
import { useState } from "react";
import { BatteryCharging, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ocrBatteryTest } from "@/lib/ocr.functions";
import { blobToDataUrl, compressImage, uploadPhoto } from "@/lib/photo";

export type BatteryTest = {
  verdict?: string | null;
  voltage?: number | null;
  cca_measured?: number | null;
  cca_rated?: number | null;
  soh_pct?: number | null;
  soc_pct?: number | null;
};

const VERDICTS: { key: string; label: string }[] = [
  { key: "bonne", label: "Bonne" },
  { key: "a_surveiller", label: "À surveiller" },
  { key: "a_remplacer", label: "À remplacer" },
];

function num(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

export function BatteryTestCard({
  pointId,
  inspectionId,
  initial,
  onSaved,
}: {
  pointId: string;
  inspectionId: string;
  initial: BatteryTest | null;
  onSaved?: (test: BatteryTest) => void;
}) {
  const [test, setTest] = useState<BatteryTest>(initial ?? {});
  const [busy, setBusy] = useState(false);

  async function save(next: BatteryTest) {
    setTest(next);
    const { error } = await supabase
      .from("inspection_points")
      .update({
        battery_test: JSON.parse(JSON.stringify(next)),
        measure_value: next.cca_measured != null ? `${next.cca_measured} CCA` : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pointId);
    if (error) toast.error("Test batterie non enregistré");
    else onSaved?.(next);
  }

  async function onFile(file: File) {
    setBusy(true);
    try {
      const compressed = await compressImage(file, 1600, 0.85);
      const media = await uploadPhoto(compressed, `inspections/${inspectionId}`, {
        inspection_id: inspectionId,
        inspection_point_id: pointId,
      });
      const dataUrl = await blobToDataUrl(compressed);
      const res = await ocrBatteryTest({ data: { dataUrl, filename: "batterie.jpg" } });
      if (!res.ok) {
        toast.error(res.error || "Lecture du ticket impossible — saisie manuelle possible.");
        return;
      }
      const parsed = JSON.parse(res.json) as BatteryTest;
      await save({ ...test, ...parsed });
      if (media?.id) {
        await supabase
          .from("inspection_points")
          .update({ battery_media_id: media.id })
          .eq("id", pointId);
      }
      toast.success("Ticket batterie lu — vérifiez les valeurs");
    } catch (e) {
      console.error(e);
      toast.error("Lecture du ticket impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border-2 border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-widest">Test batterie</span>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold uppercase text-brand-foreground">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BatteryCharging className="h-4 w-4" />}
          Photo du ticket
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onFile(f);
            }}
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-1">
        {VERDICTS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => void save({ ...test, verdict: v.key })}
            className={`rounded-lg px-2 py-2 text-[11px] font-bold uppercase ${
              test.verdict === v.key ? "bg-foreground text-background" : "bg-card text-muted-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["voltage", "Tension (V)"],
            ["cca_measured", "CCA mesuré"],
            ["cca_rated", "CCA nominal"],
            ["soh_pct", "SOH (%)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {label}
            <input
              inputMode="decimal"
              defaultValue={num(test[key])}
              onBlur={(e) => {
                const raw = e.target.value.replace(",", ".").trim();
                const value = raw === "" ? null : Number(raw);
                if (value !== null && !Number.isFinite(value)) return;
                void save({ ...test, [key]: value });
              }}
              className="mt-1 w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-base"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
