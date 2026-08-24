/** Import / mise à jour du référentiel forfaits Renault / Dacia (managers). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, RotateCw } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { useAuth } from "@/lib/auth";
import { blobToDataUrl } from "@/lib/photo";
import { analyzePackageMementoFn } from "@/lib/packages-import.functions";
import { extractPagesDataUrl, loadPdf } from "@/lib/pdf-split";
import {
  DEFAULT_BATCH_SIZE,
  clearJob,
  consolidate,
  jobIdFor,
  loadJob,
  offsetLines,
  pendingBatches,
  planBatches,
  saveJob,
  summarize,
  summaryText,
  upsertOutcome,
  type BatchOutcome,
  type JobState,
} from "@/lib/packages-batch";
import {
  SOURCE_KINDS,
  SOURCE_LABEL,
  importLines,
  linesFromAi,
  linesFromRows,
  toPrices,
  type DetectedLine,
  type SourceKind,
} from "@/lib/packages-import";

const MAX_ATTEMPTS = 3;

function fileRows(buf: ArrayBuffer): string[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

export function PackageImport({ onImported }: { onImported: () => void | Promise<unknown> }) {
  const { user, displayName } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<SourceKind>("renault_public");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<DetectedLine[]>([]);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [job, setJob] = useState<JobState | null>(null);
  const [current, setCurrent] = useState<{ from: number; to: number } | null>(null);
  const [resumable, setResumable] = useState<JobState | null>(null);

  const selected = useMemo(() => lines.filter((_, i) => checked[i] !== false), [lines, checked]);
  const progress = useMemo(() => (job ? summarize(job) : null), [job]);

  useEffect(() => {
    const saved = loadJob();
    if (saved) setResumable(saved);
  }, []);

  function finish(state: JobState) {
    const merged = consolidate(state.outcomes);
    setLines(merged.lines);
    setChecked({});
    setWarnings(merged.warnings);
    setCurrent(null);
    const s = summarize(state);
    if (!merged.lines.length) toast.error("Aucune ligne de forfait exploitable détectée.");
    else toast.success(summaryText(s));
  }

  /** Traite tous les lots restants d'un PDF, avec retry et sauvegarde après chaque lot. */
  async function runBatches(file: File, initial: JobState) {
    const { doc } = await loadPdf(file);
    let state = initial;
    setJob(state);

    for (const batch of pendingBatches(state)) {
      setCurrent({ from: batch.from, to: batch.to });
      const dataUrl = await extractPagesDataUrl(doc, batch.from, batch.to);
      let outcome: BatchOutcome | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const res = await analyzePackageMementoFn({
            data: { dataUrl, filename: file.name, pageFrom: batch.from, pageTo: batch.to },
          });
          if (!res.ok) throw new Error(res.error);
          const out = linesFromAi(JSON.parse(res.json), {
            source_kind: state.sourceKind as SourceKind,
            source_file_name: file.name,
            source_version: state.version,
          });
          outcome = {
            index: batch.index,
            from: batch.from,
            to: batch.to,
            status: "done",
            attempts: attempt,
            lines: offsetLines(out.lines, batch),
            warnings: out.warnings,
          };
          break;
        } catch (e) {
          if (attempt === MAX_ATTEMPTS) {
            outcome = {
              index: batch.index,
              from: batch.from,
              to: batch.to,
              status: "failed",
              attempts: attempt,
              lines: [],
              warnings: [],
              error: e instanceof Error ? e.message : "analyse impossible",
            };
          } else {
            await new Promise((r) => setTimeout(r, 800 * attempt));
          }
        }
      }

      state = upsertOutcome(state, outcome!);
      saveJob(state);
      setJob(state);
    }

    finish(state);
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setResumable(null);
    const all: DetectedLine[] = [];
    const warns: string[] = [];
    try {
      const list = Array.from(files);
      const pdfs = list.filter((f) => /\.pdf$/i.test(f.name));

      // Un PDF seul : traitement par lots de pages avec progression et reprise.
      if (pdfs.length === 1 && list.length === 1) {
        const file = pdfs[0]!;
        const { pageCount } = await loadPdf(file);
        const state: JobState = {
          jobId: jobIdFor(file.name, file.size, kind, version.trim() || null),
          fileName: file.name,
          fileSize: file.size,
          sourceKind: kind,
          version: version.trim() || null,
          totalPages: pageCount,
          batchSize: DEFAULT_BATCH_SIZE,
          outcomes: [],
          updatedAt: new Date().toISOString(),
        };
        saveJob(state);
        await runBatches(file, state);
        return;
      }

      for (const file of list) {
        const ctx = { source_kind: kind, source_file_name: file.name, source_version: version.trim() || null };
        const isSheet = /\.(csv|xlsx|xls)$/i.test(file.name);
        if (isSheet) {
          const out = linesFromRows(fileRows(await file.arrayBuffer()), ctx);
          all.push(...out.lines);
          warns.push(...out.warnings.map((w) => `${file.name} — ${w}`));
        } else {
          const dataUrl = await blobToDataUrl(file);
          const res = await analyzePackageMementoFn({ data: { dataUrl, filename: file.name } });
          if (!res.ok) {
            warns.push(`${file.name} — ${res.error}`);
            continue;
          }
          const out = linesFromAi(JSON.parse(res.json), ctx);
          all.push(...out.lines);
          warns.push(...out.warnings.map((w) => `${file.name} — ${w}`));
        }
      }
      setLines(all);
      setChecked({});
      setWarnings(warns);
      if (!all.length) toast.error("Aucune ligne de forfait exploitable détectée.");
      else toast.success(`${all.length} ligne(s) détectée(s)`);
    } catch {
      toast.error("Lecture du fichier impossible.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /** Reprise d'un job interrompu : seuls les lots manquants ou en échec sont relancés. */
  async function resume(files: FileList | null) {
    const file = files?.[0];
    const saved = resumable;
    if (!file || !saved) return;
    setBusy(true);
    setResumable(null);
    try {
      setKind(saved.sourceKind as SourceKind);
      setVersion(saved.version ?? "");
      await runBatches(file, saved);
    } catch {
      toast.error("Reprise impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!selected.length) return;
    setBusy(true);
    try {
      const res = await importLines(selected, {
        userId: user?.id ?? null,
        userName: displayName || null,
        warnings,
        sourceKind: kind,
        fileName: selected[0]?.source_file_name ?? "import",
        version: version.trim() || selected[0]?.source_version || null,
      });
      toast.success(
        `${res.inserted} créé(s), ${res.updated} mis à jour, ${res.unchanged} inchangé(s)`,
      );
      setLines([]);
      setWarnings([]);
      clearJob();
      setJob(null);
      await onImported();
    } catch {
      toast.error("Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  const showPreview = lines.length > 0 && !busy;

  return (
    <div className="rounded-xl border-2 border-border p-3">
      <h3 className="text-xs font-bold uppercase tracking-widest">
        Importer / mettre à jour le référentiel forfaits
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Mémentos PDF complets (Renault Public, Renault Pro/LLD, Dacia Public), même de 250 à 400
        pages : le document est analysé automatiquement page par page, par lots, jusqu'à la dernière
        page. Fichiers CSV/XLSX déjà structurés également acceptés. Aucune page n'est écartée
        volontairement : une page illisible est signalée « à contrôler ». Réimporter le même mémento
        ne crée aucun doublon.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Référentiel
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SourceKind)}
            disabled={busy}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {SOURCE_KINDS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} · prix {s.basis.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Version / date du mémento
          </label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="ex. 01/2026"
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.csv,.xlsx,.xls,image/*"
        className="hidden"
        onChange={(e) => void (resumable ? resume(e.target.files) : handleFiles(e.target.files))}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-border px-4 py-3 text-xs font-bold uppercase"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        {busy ? "Analyse en cours" : "Choisir un ou plusieurs fichiers"}
      </button>

      {resumable && !busy ? (
        <div className="mt-3 rounded-lg border border-brand bg-brand/5 p-2 text-[11px]">
          <div className="flex items-center gap-2 font-bold">
            <RotateCw className="h-3.5 w-3.5" /> Import interrompu : {resumable.fileName}
          </div>
          <p className="mt-1">
            {summaryText(summarize(resumable))} — {summarize(resumable).percent} % traité.
            Re-sélectionnez le même PDF pour reprendre : les lots déjà réussis ne seront pas
            relancés.
          </p>
          <button
            onClick={() => {
              clearJob();
              setResumable(null);
            }}
            className="mt-1 text-[10px] font-bold uppercase underline"
          >
            Abandonner cet import
          </button>
        </div>
      ) : null}

      {busy && progress ? (
        <div className="mt-3 space-y-1 rounded-lg border border-border p-2 text-[11px]">
          <div className="font-bold">
            {job?.fileName} · {progress.totalPages} pages
          </div>
          <div>
            {current
              ? `Analyse ${current.from}–${current.to} / ${progress.totalPages} pages`
              : "Préparation du document…"}{" "}
            · {progress.percent} %
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-brand transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="text-muted-foreground">
            {progress.linesDetected} forfait(s) détecté(s) · {progress.warnings} avertissement(s)
            {progress.pagesFailed ? ` · ${progress.pagesFailed} page(s) à contrôler` : ""}
          </div>
        </div>
      ) : null}

      {showPreview && job ? (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-2 text-[11px] font-bold">
          {summaryText(summarize(job))}
        </p>
      ) : null}

      {showPreview && warnings.length ? (
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {showPreview ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {selected.length} / {lines.length} ligne(s) sélectionnée(s). Vérifiez avant écriture.
          </p>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {lines.map((l, i) => {
              const p = toPrices(l.price_value, l.price_basis);
              return (
                <label
                  key={`${l.operation_code}-${i}`}
                  className="flex items-start gap-2 rounded-lg border border-border px-2 py-2 text-[11px]"
                >
                  <input
                    type="checkbox"
                    checked={checked[i] !== false}
                    onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))}
                    className="mt-1"
                  />
                  <span className="flex-1">
                    <span className="font-bold">
                      {l.operation_code} · {l.label}
                    </span>
                    <br />
                    {l.brand}
                    {l.model ? ` ${l.model}` : l.segment ? ` · ${l.segment}` : ""}
                    {l.energies.length ? ` · ${l.energies.join(", ")}` : ""}
                    {l.year_from || l.year_to ? ` · ${l.year_from ?? "?"}–${l.year_to ?? "?"}` : ""}
                    <br />
                    {l.price_value != null
                      ? `${l.price_value.toFixed(2)} € ${l.price_basis.toUpperCase()} source → ${p.price_ttc?.toFixed(2)} € TTC`
                      : "prix non renseigné"}
                    {l.hours != null ? ` · ${l.hours} h` : ""}
                    <br />
                    <span className="text-muted-foreground">
                      {SOURCE_LABEL[l.source_kind]} · {l.source_file_name}
                      {l.source_page ? ` p.${l.source_page}` : ""}
                      {l.source_version ? ` · ${l.source_version}` : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <button
            onClick={() => void runImport()}
            disabled={busy || !selected.length}
            className="w-full rounded-xl bg-brand px-4 py-3 text-xs font-bold uppercase text-brand-foreground disabled:opacity-50"
          >
            Importer / mettre à jour
          </button>
        </div>
      ) : null}
    </div>
  );
}
