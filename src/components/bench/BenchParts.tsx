/** Recette IA — blocs d'affichage (comparaison, réponses brutes, temps, scores, vérité terrain). */
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { BenchRun } from "@/lib/bench-export";
import type { BenchOutput } from "@/lib/bench-schema";
import { diffOutputs, flatten, type BenchScore, type DiffRow } from "@/lib/bench-score";

const VARIANT_LABEL = { A: "Modèle A", B: "Modèle B", pipeline: "Pipeline réel DDA" } as const;
export const variantLabel = (v: keyof typeof VARIANT_LABEL) => VARIANT_LABEL[v];

const fmtMs = (n: number | null | undefined) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);

export function RunCard({ run, score, onRerun, busy }: { run: BenchRun | null; score?: BenchScore | null; onRerun?: () => void; busy?: boolean }) {
  const [raw, setRaw] = useState(false);
  if (!run) return null;
  return (
    <div className="rounded-xl border-2 border-border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-extrabold uppercase tracking-wide">{variantLabel(run.variant)}</div>
          <div className="break-all text-xs text-muted-foreground">{run.model} · {run.promptVersion}{run.route ? ` · ${run.route}` : ""}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${run.success ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"}`}>
          {run.success ? "OK" : run.failureReason ?? "échec"}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Temps IA</dt><dd className="text-right font-semibold">{fmtMs(run.aiMs)}</dd>
        <dt className="text-muted-foreground">Média serveur</dt><dd className="text-right">{fmtMs(run.mediaMs)}</dd>
        <dt className="text-muted-foreground">Parsing</dt><dd className="text-right">{fmtMs(run.parseMs)}</dd>
        <dt className="text-muted-foreground">Serveur</dt><dd className="text-right">{fmtMs(run.serverMs)}</dd>
        <dt className="text-muted-foreground">Total (clic → résultat)</dt><dd className="text-right font-semibold">{fmtMs(run.totalMs)}</dd>
        <dt className="text-muted-foreground">Tokens in / out</dt><dd className="text-right">{run.tokensIn} / {run.tokensOut}</dd>
        <dt className="text-muted-foreground">Coût estimé</dt><dd className="text-right">{run.credits} crédits</dd>
        <dt className="text-muted-foreground">HTTP · cache · appels</dt><dd className="text-right">{run.httpStatus ?? "—"} · {run.cacheHit ? "oui" : "non"} · {run.aiCalls}</dd>
        <dt className="text-muted-foreground">Lancé le</dt><dd className="text-right">{new Date(run.startedAt).toLocaleString("fr-FR")}</dd>
      </dl>
      {score ? <ScoreLine score={score} /> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {onRerun ? (
          <button type="button" disabled={busy} onClick={onRerun} className="rounded-lg border-2 border-border px-3 py-1.5 text-xs font-bold disabled:opacity-50">
            Relancer
          </button>
        ) : null}
        <button type="button" onClick={() => setRaw((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border-2 border-border px-3 py-1.5 text-xs font-bold">
          {raw ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Voir la réponse brute
        </button>
      </div>
      {raw ? (
        <div className="mt-2 space-y-2">
          <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-2 text-[11px] leading-snug">{run.rawText || "(vide)"}</pre>
          <details><summary className="cursor-pointer text-xs font-semibold">Invite exacte ({run.promptHash.slice(0, 10)})</summary>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-[11px]">{run.promptText}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}

function ScoreLine({ score }: { score: BenchScore }) {
  const p = (n: number | null) => (n == null ? "—" : `${n} %`);
  return (
    <div className="mt-2 rounded-lg bg-muted p-2 text-xs">
      <div className="font-bold">Score global {p(score.global.rate)} <span className="font-normal text-muted-foreground">({score.global.correct} ok · {score.global.wrong} faux · {score.global.missing} manquants)</span></div>
      <div className="text-muted-foreground">Lignes {p(score.lines.rate)} · Réfs {p(score.references.rate)} · OR/immat {p(score.identifiers.rate)} · Montants {p(score.amounts.rate)}</div>
    </div>
  );
}

const STATUS_CLS: Record<DiffRow["status"], string> = {
  identique: "",
  different: "bg-destructive/10",
  absent_a: "bg-accent/40",
  absent_b: "bg-accent/40",
};
const STATUS_LABEL: Record<DiffRow["status"], string> = { identique: "identique", different: "DIFFÉRENT", absent_a: "non trouvé A", absent_b: "non trouvé B" };

export function DiffTable({ a, b, pipeline }: { a: BenchOutput | null; b: BenchOutput | null; pipeline: BenchOutput | null }) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const rows = diffOutputs(a, b);
  const fp = flatten(pipeline);
  const shown = onlyDiff ? rows.filter((r) => r.status !== "identique") : rows;
  if (!rows.length) return <p className="text-sm text-muted-foreground">Aucun champ extrait pour l'instant.</p>;
  return (
    <div>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> Différences seulement ({rows.filter((r) => r.status !== "identique").length})
      </label>
      <div className="overflow-x-auto rounded-xl border-2 border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted text-left"><tr><th className="p-2">Champ</th><th className="p-2">A</th><th className="p-2">B</th><th className="p-2">Pipeline</th><th className="p-2">État</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.path} className={`border-t border-border ${STATUS_CLS[r.status]}`}>
                <td className="p-2 font-mono">{r.path}</td>
                <td className="break-all p-2">{r.a || "—"}</td>
                <td className="break-all p-2">{r.b || "—"}</td>
                <td className="break-all p-2 text-muted-foreground">{fp[r.path] ?? "—"}</td>
                <td className={`p-2 font-bold ${r.status === "different" ? "text-destructive" : ""}`}>{STATUS_LABEL[r.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Saisie des valeurs attendues : éditeur JSON prérempli (sortie A ou B), validé à la main. */
export function TruthForm({ initial, onSave }: { initial: BenchOutput | null; onSave: (v: BenchOutput) => void }) {
  const [text, setText] = useState(() => JSON.stringify(initial ?? {}, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Corrigez les valeurs pour qu'elles correspondent exactement au document. Mettez null pour un champ absent du document.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="w-full rounded-lg border-2 border-border bg-background p-2 font-mono text-xs" />
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <button
        type="button"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
        onClick={() => {
          try {
            const v = JSON.parse(text) as BenchOutput;
            const { confidence: _c, failure_reasons: _f, ...clean } = v;
            setErr(null);
            onSave(clean);
          } catch {
            setErr("JSON invalide : vérifiez les guillemets et virgules.");
          }
        }}
      >
        Valider les valeurs attendues
      </button>
    </div>
  );
}
