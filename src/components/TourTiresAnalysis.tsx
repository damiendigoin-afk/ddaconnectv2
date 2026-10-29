/** Écran « Analyse des 4 pneus » de fin de tour : lance UNE analyse IA groupée, attente, puis correction/validation. */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { TireTreadOverlay } from "@/components/TireTreadOverlay";
import { estimatedAnalysisProgress, replacementRecommendation, TOUR_TIRE_KEYS, type TourTireKey } from "@/lib/tour-tire-analysis";
import { EXPERIMENTAL_DEPTH_NOTICE, zoneLabels, type TireStepResult } from "@/lib/tire-step";
import { autoStatusFromResult, TIRE_STATUS_LABEL, type TireEditState, type TireStatus } from "@/lib/tour-tire-correction";

export type TourTiresRun =
  | { ok: true; results: Record<TourTireKey, TireStepResult>; proof?: Partial<Record<TourTireKey, { mainPhotoUrl?: string | null }>> }
  | { ok: false; error: string };

type Props = {
  plate: string;
  tourId: string;
  run: (force: boolean) => Promise<TourTiresRun>;
  onValidate: (results: Partial<Record<TourTireKey, TireStepResult>>) => Promise<void>;
  onBack: () => void;
  /** Mode édition (tour clôturé) : données enregistrées préchargées, AUCUN appel IA automatique. */
  edit?: {
    initial: Partial<Record<TourTireKey, TireEditState>>;
    proof: Partial<Record<TourTireKey, { mainPhotoUrl?: string | null }>>;
    /** Relance IA volontaire : ne doit rien enregistrer. */
    rerun: () => Promise<TourTiresRun>;
    onSave: (edits: Partial<Record<TourTireKey, TireEditState>>) => Promise<{ missingReason?: TourTireKey[] } | void>;
  };
};

export function TourTiresAnalysis(props: Props) {
  return props.edit ? <TourTiresEdit {...props} edit={props.edit} /> : <TourTiresInitial {...props} />;
}

function TourTiresInitial({ plate, tourId, run, onValidate, onBack }: Props) {
  const [state, setState] = useState<"running" | "review" | "error">("running");
  const [progress, setProgress] = useState(4);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Partial<Record<TourTireKey, TireStepResult>>>({});
  const [proof, setProof] = useState<Partial<Record<TourTireKey, { mainPhotoUrl?: string | null }>>>({});
  const inFlight = useRef(false);
  const started = useRef(false);

  async function launch(force: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setState("running"); setError(""); setProgress(4);
    const t0 = Date.now();
    const timer = window.setInterval(() => setProgress(estimatedAnalysisProgress(Date.now() - t0)), 350);
    try {
      const r = await run(force);
      if (!r.ok) { setError(r.error || "Analyse IA impossible."); setState("error"); return; }
      setResults(r.results); setProof(r.proof ?? {}); setProgress(100); setState("review");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Analyse IA impossible."); setState("error");
    } finally { window.clearInterval(timer); inFlight.current = false; }
  }

  // Déclenchement automatique, une seule fois, à l'ouverture (clic « Terminer le tour »).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void launch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setDepth(key: TourTireKey, field: "inner_mm" | "center_mm" | "outer_mm", value: number | null) {
    setResults((all) => {
      const current = all[key]; if (!current) return all;
      const depth = { ...current.depth, [field]: value };
      depth.points_mm = [depth.inner_mm, depth.center_mm, depth.outer_mm].filter((v): v is number => v !== null);
      return { ...all, [key]: { ...current, depth } };
    });
  }

  const recommendation = replacementRecommendation(results);
  return (
    <AppShell title="Analyse des 4 pneus" subtitle={plate} back={{ to: "/tour/$tourId", params: { tourId } }}>
      <div className="space-y-4">
        {state === "running" ? (
          <section className="card-surface space-y-3 p-5 text-center" role="status">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-brand" />
            <h2 className="font-extrabold uppercase">Analyse IA en cours</h2>
            <div className="h-3 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} /></div>
            <p className="text-sm font-bold">{progress} % estimé</p>
            <p className="text-xs text-muted-foreground">Les 12 photos des quatre roues sont analysées ensemble.</p>
          </section>
        ) : null}
        {state === "error" ? (
          <section className="card-surface space-y-3 border-2 border-destructive p-4" role="alert">
            <p className="font-bold text-destructive">{error}</p>
            <p className="text-sm">Vos photos sont conservées. Relancez l’analyse ou reprenez seulement les photos manquantes.</p>
            <button onClick={() => void launch(true)} className="w-full rounded-xl bg-brand px-4 py-3 font-bold uppercase text-brand-foreground">Réessayer</button>
            <button onClick={onBack} className="w-full rounded-xl border-2 border-border px-4 py-3 font-bold uppercase">Revenir au tour</button>
          </section>
        ) : null}
        {state === "review" ? (
          <>
            <section className="card-surface p-4">
              <h2 className="font-extrabold uppercase">Synthèse des quatre roues</h2>
              <p className="mt-1 text-sm font-bold">{recommendation.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{EXPERIMENTAL_DEPTH_NOTICE}</p>
            </section>
            {TOUR_TIRE_KEYS.map((key) => {
              const r = results[key]; if (!r) return null;
              const src = proof[key]?.mainPhotoUrl; const labels = zoneLabels(r.depth.inner_side);
              return (
                <section key={key} className="card-surface space-y-3 p-4" data-testid={`wheel-${key}`}>
                  <h3 className="font-extrabold uppercase">{key.replace("pneu_", "Pneu ")}</h3>
                  {src ? <TireTreadOverlay src={src} values={[r.depth.inner_mm, r.depth.center_mm, r.depth.outer_mm]} labels={labels} onAdjust={(i, v) => setDepth(key, (["inner_mm", "center_mm", "outer_mm"] as const)[i]!, v)} /> : null}
                  <div className="grid grid-cols-3 gap-2">
                    {(["inner_mm", "center_mm", "outer_mm"] as const).map((f, i) => (
                      <label key={f} className="text-center text-[10px] font-bold uppercase">{labels[i]}
                        <input aria-label={`${key} ${labels[i]}`} inputMode="decimal" value={r.depth[f] ?? ""} onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); setDepth(key, f, e.target.value && Number.isFinite(n) ? Math.min(12, Math.max(0, n)) : null); }} className="mt-1 w-full rounded-lg border-2 border-border px-2 py-2 text-center text-lg" />
                      </label>
                    ))}
                  </div>
                  <p className="text-sm"><b>Usure :</b> {r.wear.pattern ?? "non déterminée"} · <b>Témoin :</b> {r.wear.wear_indicator ?? "non déterminé"}</p>
                  <p className="text-sm text-muted-foreground">{r.wear.recommendation ?? r.wear.observations.join(" · ")}</p>
                </section>
              );
            })}
            <button onClick={() => void onValidate(results)} className="w-full rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase text-brand-foreground">Valider les pneus et terminer</button>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

const STATUS_ORDER: TireStatus[] = ["ok", "watch", "defect"];

function TourTiresEdit({ plate, tourId, onBack, edit }: Props & { edit: NonNullable<Props["edit"]> }) {
  const [rows, setRows] = useState(edit.initial);
  const [proof, setProof] = useState(edit.proof);
  const [busy, setBusy] = useState<"" | "ai" | "save">("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<TourTireKey[]>([]);

  function patch(key: TourTireKey, p: Partial<TireEditState>) {
    setRows((all) => { const cur = all[key]; return cur ? { ...all, [key]: { ...cur, ...p } } : all; });
  }
  function setDepth(key: TourTireKey, field: "inner_mm" | "center_mm" | "outer_mm", value: number | null) {
    const cur = rows[key]?.result; if (!cur) return;
    const depth = { ...cur.depth, [field]: value };
    depth.points_mm = [depth.inner_mm, depth.center_mm, depth.outer_mm].filter((v): v is number => v !== null);
    patch(key, { result: { ...cur, depth } });
  }

  async function rerun() {
    if (busy) return;
    if (!window.confirm("Relancer l’analyse IA ? Les valeurs affichées seront remplacées (rien n’est enregistré avant validation).")) return;
    setBusy("ai"); setError("");
    try {
      const r = await edit.rerun();
      if (!r.ok) { setError(r.error || "Analyse IA impossible."); return; }
      setRows((all) => {
        const next = { ...all };
        for (const k of TOUR_TIRE_KEYS) { const res = r.results[k]; if (res && next[k]) next[k] = { ...next[k]!, result: res, status: autoStatusFromResult(res) }; }
        return next;
      });
      setProof((p) => ({ ...p, ...(r.proof ?? {}) }));
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "Analyse IA impossible."); }
    finally { setBusy(""); }
  }

  async function save() {
    if (busy) return;
    setBusy("save"); setError(""); setMissing([]);
    try {
      const r = await edit.onSave(rows);
      if (r && r.missingReason?.length) { setMissing(r.missingReason); setError("Indiquez la raison de chaque correction."); }
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "Corrections non enregistrées."); }
    finally { setBusy(""); }
  }

  const results = Object.fromEntries(TOUR_TIRE_KEYS.flatMap((k) => (rows[k]?.result ? [[k, rows[k]!.result!]] : []))) as Partial<Record<TourTireKey, TireStepResult>>;
  const recommendation = replacementRecommendation(results);
  return (
    <AppShell title="Analyse des 4 pneus" subtitle={plate} back={{ to: "/tour/$tourId", params: { tourId } }}>
      <div className="space-y-4">
        <p className="rounded-lg bg-status-watch-soft px-3 py-2 text-xs font-bold uppercase text-status-watch">Mode édition — résultats enregistrés, l’IA n’est pas relancée automatiquement</p>
        <section className="card-surface p-4">
          <h2 className="font-extrabold uppercase">Synthèse des quatre roues</h2>
          <p className="mt-1 text-sm font-bold">{recommendation.label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{EXPERIMENTAL_DEPTH_NOTICE}</p>
        </section>
        {error ? <p role="alert" className="rounded-lg border-2 border-destructive p-3 text-sm font-bold text-destructive">{error}</p> : null}
        {TOUR_TIRE_KEYS.map((key) => {
          const row = rows[key]; if (!row) return null;
          const r = row.result; const src = proof[key]?.mainPhotoUrl; const labels = zoneLabels(r?.depth.inner_side ?? null);
          return (
            <section key={key} className="card-surface space-y-3 p-4" data-testid={`wheel-${key}`}>
              <h3 className="font-extrabold uppercase">{key.replace("pneu_", "Pneu ")}</h3>
              {src && r ? <TireTreadOverlay src={src} values={[r.depth.inner_mm, r.depth.center_mm, r.depth.outer_mm]} labels={labels} onAdjust={(i, v) => setDepth(key, (["inner_mm", "center_mm", "outer_mm"] as const)[i]!, v)} /> : null}
              {src && !r ? <img src={src} alt={`Bande de roulement ${key}`} className="w-full rounded-lg" /> : null}
              {r ? (
                <div className="grid grid-cols-3 gap-2">
                  {(["inner_mm", "center_mm", "outer_mm"] as const).map((f, i) => (
                    <label key={f} className="text-center text-[10px] font-bold uppercase">{labels[i]}
                      <input aria-label={`${key} ${labels[i]}`} inputMode="decimal" value={r.depth[f] ?? ""} onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); setDepth(key, f, e.target.value && Number.isFinite(n) ? Math.min(12, Math.max(0, n)) : null); }} className="mt-1 w-full rounded-lg border-2 border-border px-2 py-2 text-center text-lg" />
                    </label>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">Aucune analyse enregistrée pour cette roue.</p>}
              <div role="radiogroup" aria-label={`Statut ${key}`} className="grid grid-cols-3 gap-2">
                {STATUS_ORDER.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={row.status === s} onClick={() => patch(key, { status: s })}
                    className={`rounded-lg border-2 px-2 py-2 text-xs font-bold uppercase ${row.status === s ? (s === "ok" ? "border-status-ok bg-status-ok-soft text-status-ok" : s === "watch" ? "border-status-watch bg-status-watch-soft text-status-watch" : "border-status-defect bg-status-defect-soft text-status-defect") : "border-border bg-card text-muted-foreground"}`}>
                    {TIRE_STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
              <label className="block text-xs font-bold uppercase">Raison de la correction
                <textarea aria-label={`Raison ${key}`} value={row.reason} onChange={(e) => patch(key, { reason: e.target.value })} rows={2}
                  className={`mt-1 w-full rounded-lg border-2 px-2 py-2 text-sm normal-case ${missing.includes(key) ? "border-destructive" : "border-border"}`} placeholder="Obligatoire si le statut ou une mesure change" />
              </label>
              {r ? <p className="text-sm"><b>Usure :</b> {r.wear.pattern ?? "non déterminée"} · <b>Témoin :</b> {r.wear.wear_indicator ?? "non déterminé"}</p> : null}
            </section>
          );
        })}
        <button disabled={!!busy} onClick={() => void save()} className="w-full rounded-xl bg-brand px-4 py-5 text-lg font-extrabold uppercase text-brand-foreground disabled:opacity-50">
          {busy === "save" ? "Enregistrement…" : "Valider les corrections"}
        </button>
        <button disabled={!!busy} onClick={() => void rerun()} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-border bg-card px-4 py-3 text-sm font-bold uppercase disabled:opacity-50">
          {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Relancer l’analyse IA
        </button>
        <button disabled={busy === "save"} onClick={onBack} className="w-full rounded-xl border-2 border-border px-4 py-3 text-sm font-bold uppercase">Retour sans enregistrer</button>
      </div>
    </AppShell>
  );
}
