/**
 * Import / mise à jour du référentiel forfaits Renault / Dacia (managers).
 *
 * Parcours DÉTERMINISTE : couche texte du PDF (pdfjs) + parseur métier, 0 crédit IA.
 * L'IA n'intervient jamais automatiquement : uniquement sur les pages scannées,
 * après confirmation explicite du manager et affichage du coût estimé.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Paperclip, RotateCw } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

import { useAuth } from "@/lib/auth";
import { analyzePackageMementoFn } from "@/lib/packages-import.functions";
import { extractPdfText, fileFingerprint } from "@/lib/pdf-text";
import { parseDocument } from "@/lib/packages-parse";
import { extractPagesDataUrl, loadPdf } from "@/lib/pdf-split";
import {
  deleteImportJob,
  finishImportJob,
  jobKey,
  latestRunningJob,
  saveImportJob,
  type ImportJob,
} from "@/lib/import-jobs";
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

const MODULE = "memento";
/** Coût moyen constaté d'un lot de 12 pages envoyé au modèle visuel. */
const CREDITS_PER_AI_PAGE = 0.2;

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
  const [scanned, setScanned] = useState<number[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resumable, setResumable] = useState<ImportJob | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [jobRef, setJobRef] = useState<string | null>(null);

  const selected = useMemo(() => lines.filter((_, i) => checked[i] !== false), [lines, checked]);
  const aiCost = useMemo(() => Math.round(scanned.length * CREDITS_PER_AI_PAGE * 100) / 100, [scanned]);

  useEffect(() => {
    void latestRunningJob(MODULE).then((j) => setResumable(j));
  }, []);

  /* ------------------------------ PDF texte ------------------------------ */

  async function runDeterministic(file: File, resume?: ImportJob | null) {
    const fp = await fileFingerprint(file);
    const key = jobKey(MODULE, fp, kind);
    setJobRef(key);
    const done = new Set<number>(resume?.state?.donePages ?? []);
    const previousLines = (resume?.state?.lines ?? []) as DetectedLine[];
    const previousWarnings = resume?.state?.uncertain ?? [];

    const { pages, pageCount } = await extractPdfText(
      file,
      (d, t) => setProgress({ done: d, total: t }),
      done.size ? done : undefined,
    );

    const parsed = parseDocument(pages, {
      kind,
      fileName: file.name,
      version: version.trim() || resume?.state?.version || null,
    });

    const allLines = [...previousLines, ...parsed.lines];
    const allWarnings = [...previousWarnings, ...parsed.uncertain];

    setLines(allLines);
    setChecked({});
    setWarnings(allWarnings);
    setScanned(parsed.scannedPages);
    setPendingFile(file);
    if (parsed.version && !version.trim()) setVersion(parsed.version);

    await saveImportJob({
      key,
      kind,
      fileName: file.name,
      fileSize: file.size,
      fingerprint: fp,
      totalPages: pageCount,
      state: {
        version: parsed.version,
        donePages: pages.map((p) => p.page).concat([...done]),
        lines: allLines,
        uncertain: allWarnings,
      },
      userId: user?.id ?? null,
    });

    if (!allLines.length) {
      toast.error("Aucun forfait exploitable détecté dans la couche texte de ce document.");
    } else {
      toast.success(
        `${allLines.length} forfait(s) extrait(s) sur ${pageCount} pages — 0 crédit IA consommé`,
      );
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setResumable(null);
    setProgress(null);
    try {
      const list = Array.from(files);
      const pdfs = list.filter((f) => /\.pdf$/i.test(f.name));

      if (pdfs.length === 1 && list.length === 1) {
        await runDeterministic(pdfs[0]!);
        return;
      }

      const all: DetectedLine[] = [];
      const warns: string[] = [];
      for (const file of list) {
        const ctx = { source_kind: kind, source_file_name: file.name, source_version: version.trim() || null };
        if (/\.(csv|xlsx|xls)$/i.test(file.name)) {
          const out = linesFromRows(fileRows(await file.arrayBuffer()), ctx);
          all.push(...out.lines);
          warns.push(...out.warnings.map((w) => `${file.name} — ${w}`));
        } else if (/\.pdf$/i.test(file.name)) {
          const { pages } = await extractPdfText(file);
          const parsed = parseDocument(pages, { kind, fileName: file.name, version: ctx.source_version });
          all.push(...parsed.lines);
          warns.push(...parsed.uncertain);
        } else {
          warns.push(`${file.name} — image ou scan : analyse IA requise, à lancer explicitement.`);
        }
      }
      setLines(all);
      setChecked({});
      setWarnings(warns);
      setScanned([]);
      if (!all.length) toast.error("Aucune ligne de forfait exploitable détectée.");
      else toast.success(`${all.length} ligne(s) détectée(s) — 0 crédit IA`);
    } catch (e) {
      console.error(e);
      toast.error("Lecture du fichier impossible.");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  /* --------------------- Repli IA explicite (pages scannées) -------------- */

  async function analyzeScannedWithAi() {
    const file = pendingFile;
    if (!file || !scanned.length) return;
    const ok = window.confirm(
      `Analyse IA de ${scanned.length} page(s) non reconnue(s).\nCoût estimé : ~${aiCost} crédit(s).\nConfirmer ?`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { doc } = await loadPdf(file);
      const added: DetectedLine[] = [];
      const warns: string[] = [];
      for (const page of scanned) {
        const dataUrl = await extractPagesDataUrl(doc, page, page);
        const res = await analyzePackageMementoFn({
          data: { dataUrl, filename: file.name, pageFrom: page, pageTo: page },
        });
        // Aucun retry : un échec est signalé, la page reste « à contrôler ».
        if (!res.ok) {
          warns.push(`page ${page} — ${res.error}`);
          continue;
        }
        const out = linesFromAi(JSON.parse(res.json), {
          source_kind: kind,
          source_file_name: file.name,
          source_version: version.trim() || null,
        });
        added.push(...out.lines.map((l) => ({ ...l, source_page: page })));
        warns.push(...out.warnings);
      }
      setLines((prev) => [...prev, ...added]);
      setWarnings((prev) => [...prev, ...warns]);
      setScanned([]);
      toast.success(`${added.length} ligne(s) ajoutée(s) par analyse IA`);
    } catch {
      toast.error("Analyse IA impossible.");
    } finally {
      setBusy(false);
    }
  }

  /* -------------------------------- Reprise ------------------------------- */

  async function resume(files: FileList | null) {
    const file = files?.[0];
    const saved = resumable;
    if (!file || !saved) return;
    setBusy(true);
    setResumable(null);
    try {
      setKind(saved.kind as SourceKind);
      await runDeterministic(file, saved);
    } catch {
      toast.error("Reprise impossible.");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
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
      toast.success(`${res.inserted} créé(s), ${res.updated} mis à jour, ${res.unchanged} inchangé(s)`);
      setLines([]);
      setWarnings([]);
      setScanned([]);
      setPendingFile(null);
      if (jobRef) await finishImportJob(jobRef);
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
        Mémentos PDF complets (Renault Public, Renault Pro/LLD, Dacia Public), de 100 à 400+ pages :
        le document est lu directement dans sa couche texte, sans IA et sans coût. Fichiers CSV/XLSX
        également acceptés. Les pages scannées ou non reconnues restent « à contrôler » et ne sont
        jamais envoyées à une IA sans votre accord. Réimporter le même mémento ne crée aucun doublon.
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
        accept=".pdf,.csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => void (resumable ? resume(e.target.files) : handleFiles(e.target.files))}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-border px-4 py-3 text-xs font-bold uppercase"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        {busy ? "Lecture en cours" : "Choisir un ou plusieurs fichiers"}
      </button>

      {resumable && !busy ? (
        <div className="mt-3 rounded-lg border border-brand bg-brand/5 p-2 text-[11px]">
          <div className="flex items-center gap-2 font-bold">
            <RotateCw className="h-3.5 w-3.5" /> Import interrompu : {resumable.file_name}
          </div>
          <p className="mt-1">
            {(resumable.state?.donePages?.length ?? 0)} / {resumable.total_pages ?? "?"} pages déjà
            traitées. Re-sélectionnez le même PDF : les pages terminées ne sont pas retraitées.
          </p>
          <button
            onClick={() => {
              void deleteImportJob(resumable.job_key);
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
          <div>
            Lecture page {progress.done} / {progress.total} · 0 crédit IA
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {showPreview && scanned.length ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle className="h-3.5 w-3.5" /> {scanned.length} page(s) scannée(s) sans couche
            texte
          </div>
          <p className="mt-1">
            Ces pages ne sont pas importées. Analyse IA facultative — modèle visuel Gemini, coût
            estimé ~{aiCost} crédit(s).
          </p>
          <button
            onClick={() => void analyzeScannedWithAi()}
            className="mt-1 rounded-lg border border-amber-500 px-2 py-1 text-[10px] font-bold uppercase"
          >
            Analyser ces pages par IA
          </button>
        </div>
      ) : null}

      {showPreview && warnings.length ? (
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
          {warnings.slice(0, 200).map((w, i) => (
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
