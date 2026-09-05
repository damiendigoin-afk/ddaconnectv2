/**
 * Import / mise à jour du référentiel forfaits Renault / Dacia (managers).
 *
 * Parcours DÉTERMINISTE : couche texte du PDF (pdfjs) + parseur métier, 0 crédit IA.
 * Le mémento complet (250, 420, 500+ pages) est accepté sans découpage : il est
 * lu puis enregistré par lots de pages, de façon progressive et idempotente.
 * Un import interrompu reprend là où il s'était arrêté, sans doublon.
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
import { emptyContext, parseDocument, type ParseContext } from "@/lib/packages-parse";
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
  archivePreviousVersions,
  createImportRun,
  importLines,
  linesFromAi,
  linesFromRows,
  updateImportRun,
  type DetectedLine,
  type SourceKind,
} from "@/lib/packages-import";

const MODULE = "memento";
/** Coût moyen constaté d'un lot de 12 pages envoyé au modèle visuel. */
const CREDITS_PER_AI_PAGE = 0.2;
/** Taille d'un lot de pages enregistré d'un seul tenant. */
const CHUNK = 20;

type Totals = { detected: number; inserted: number; updated: number; unchanged: number };
const ZERO: Totals = { detected: 0, inserted: 0, updated: 0, unchanged: 0 };

function fileRows(buf: ArrayBuffer): string[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
}

function eta(startedAt: number, done: number, total: number): string {
  if (done < 2 || done >= total) return "";
  const perPage = (Date.now() - startedAt) / done;
  const left = Math.round((perPage * (total - done)) / 1000);
  if (left < 60) return ` · ~${left} s restantes`;
  return ` · ~${Math.round(left / 60)} min restantes`;
}

export function PackageImport({ onImported }: { onImported: () => void | Promise<unknown> }) {
  const { user, displayName } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<SourceKind>("renault_public");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"lecture" | "enregistrement" | null>(null);
  const [totals, setTotals] = useState<Totals>(ZERO);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [scanned, setScanned] = useState<number[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number; eta: string } | null>(null);
  const [resumable, setResumable] = useState<ImportJob | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [jobRef, setJobRef] = useState<string | null>(null);
  const [archived, setArchived] = useState<number | null>(null);

  const aiCost = useMemo(() => Math.round(scanned.length * CREDITS_PER_AI_PAGE * 100) / 100, [scanned]);

  useEffect(() => {
    void latestRunningJob(MODULE).then((j) => setResumable(j));
  }, []);

  /* --------------------- PDF complet, par lots de pages -------------------- */

  async function runDeterministic(file: File, resume?: ImportJob | null) {
    const fp = await fileFingerprint(file);
    const key = jobKey(MODULE, fp, kind);
    setJobRef(key);
    const donePages = new Set<number>(resume?.state?.donePages ?? []);
    const warns: string[] = [...(resume?.state?.uncertain ?? [])];
    const running: Totals = { ...(resume?.state?.totals ?? ZERO) };
    setWarnings(warns);
    setTotals(running);

    const started = Date.now();
    setPhase("lecture");
    const { pages, pageCount } = await extractPdfText(
      file,
      (d, t) => setProgress({ done: d, total: t, eta: eta(started, d, t) }),
      donePages.size ? donePages : undefined,
    );

    let importId = resume?.state?.importId ?? null;
    let docVersion = version.trim() || resume?.state?.version || null;
    // Reprise au milieu d'un tableau : on repart du contexte enregistré
    // (famille, libellé d'opération, schéma de colonnes) et non d'un contexte vide.
    let ctx: ParseContext = resume?.state?.context
      ? { ...emptyContext(docVersion), ...resume.state.context }
      : emptyContext(docVersion);
    const scannedPages: number[] = [];


    setPhase("enregistrement");
    const writeStart = Date.now();

    for (let i = 0; i < pages.length; i += CHUNK) {
      const slice = pages.slice(i, i + CHUNK);
      const parsed = parseDocument(slice, { kind, fileName: file.name, version: docVersion, context: ctx });
      ctx = parsed.context;
      if (!docVersion && parsed.version) {
        docVersion = parsed.version;
        setVersion((v) => v || parsed.version || "");
      }
      warns.push(...parsed.uncertain);
      scannedPages.push(...parsed.scannedPages);

      if (parsed.lines.length) {
        if (!importId) {
          importId = await createImportRun({
            sourceKind: kind,
            fileName: file.name,
            version: docVersion,
            userId: user?.id ?? null,
            userName: displayName || null,
          });
        }
        const res = await importLines(parsed.lines, {
          userId: user?.id ?? null,
          userName: displayName || null,
          warnings: warns,
          sourceKind: kind,
          fileName: file.name,
          version: docVersion,
          importId,
        });
        running.detected += parsed.lines.length;
        running.inserted += res.inserted;
        running.updated += res.updated;
        running.unchanged += res.unchanged;
        setTotals({ ...running });
      }

      for (const p of slice) donePages.add(p.page);
      const done = donePages.size;
      setProgress({ done, total: pageCount, eta: eta(writeStart, i + slice.length, pages.length) });
      setWarnings([...warns]);
      setScanned([...scannedPages]);

      await saveImportJob({
        key,
        kind,
        fileName: file.name,
        fileSize: file.size,
        fingerprint: fp,
        totalPages: pageCount,
        state: {
          version: docVersion,
          donePages: [...donePages],
          lines: [],
          uncertain: warns.slice(0, 500),
          importId,
          totals: { ...running },
        },
        userId: user?.id ?? null,
      });
    }

    if (importId) {
      await updateImportRun(importId, {
        detected: running.detected,
        inserted: running.inserted,
        updated: running.updated,
        warnings: warns,
      });
    }
    const archivedCount = await archivePreviousVersions(kind, docVersion);
    setArchived(archivedCount);
    setPendingFile(file);
    await finishImportJob(key);

    if (!running.detected) {
      toast.error("Aucun forfait exploitable détecté dans la couche texte de ce document.");
    } else {
      toast.success(
        `${running.detected} forfait(s) traité(s) sur ${pageCount} pages — 0 crédit IA consommé`,
      );
    }
    await onImported();
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setResumable(null);
    setProgress(null);
    setArchived(null);
    try {
      const list = Array.from(files);
      if (list.length === 1 && /\.pdf$/i.test(list[0]!.name)) {
        await runDeterministic(list[0]!);
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
      setWarnings(warns);
      setScanned([]);
      if (!all.length) {
        toast.error("Aucune ligne de forfait exploitable détectée.");
        return;
      }
      const res = await importLines(all, {
        userId: user?.id ?? null,
        userName: displayName || null,
        warnings: warns,
        sourceKind: kind,
        fileName: all[0]?.source_file_name ?? "import",
        version: version.trim() || all[0]?.source_version || null,
      });
      setTotals({
        detected: all.length,
        inserted: res.inserted,
        updated: res.updated,
        unchanged: res.unchanged,
      });
      setArchived(await archivePreviousVersions(kind, version.trim() || all[0]?.source_version || null));
      toast.success(`${res.inserted} créé(s), ${res.updated} mis à jour, ${res.unchanged} inchangé(s)`);
      await onImported();
    } catch (e) {
      console.error(e);
      toast.error("Lecture du fichier impossible.");
    } finally {
      setBusy(false);
      setPhase(null);
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
      if (added.length) {
        const res = await importLines(added, {
          userId: user?.id ?? null,
          userName: displayName || null,
          warnings: warns,
          sourceKind: kind,
          fileName: file.name,
          version: version.trim() || null,
        });
        setTotals((t) => ({
          detected: t.detected + added.length,
          inserted: t.inserted + res.inserted,
          updated: t.updated + res.updated,
          unchanged: t.unchanged + res.unchanged,
        }));
      }
      setWarnings((prev) => [...prev, ...warns]);
      setScanned([]);
      toast.success(`${added.length} ligne(s) ajoutée(s) par analyse IA`);
      await onImported();
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
      setPhase(null);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="rounded-xl border-2 border-border p-3">
      <h3 className="text-xs font-bold uppercase tracking-widest">
        Importer / mettre à jour le référentiel forfaits
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Mémentos PDF complets (Renault Public, Renault Pro/LLD, Dacia Public), de 100 à 500+ pages :
        le document est lu dans sa couche texte, sans IA et sans coût, puis enregistré au fur et à
        mesure. Fichiers CSV/XLSX également acceptés. Les pages scannées ou non reconnues restent
        « à contrôler » et ne sont jamais envoyées à une IA sans votre accord. Réimporter le même
        mémento ne crée aucun doublon ; une version plus récente archive la précédente.
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
        {busy ? "Traitement en cours" : "Choisir un ou plusieurs fichiers"}
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
            {phase === "lecture" ? "Lecture" : "Enregistrement"} page {progress.done} /{" "}
            {progress.total} · {pct} %{progress.eta} · 0 crédit IA
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div>
            {totals.detected} forfait(s) traité(s) — {totals.inserted} créé(s), {totals.updated} mis
            à jour, {totals.unchanged} inchangé(s)
          </div>
        </div>
      ) : null}

      {!busy && totals.detected ? (
        <div className="mt-3 rounded-lg border border-border p-2 text-[11px]">
          <div className="font-bold">Import terminé</div>
          <div>
            {totals.detected} forfait(s) traité(s) — {totals.inserted} créé(s), {totals.updated} mis
            à jour, {totals.unchanged} inchangé(s)
          </div>
          {archived ? <div>{archived} forfait(s) d'une version antérieure archivé(s).</div> : null}
        </div>
      ) : null}

      {!busy && scanned.length ? (
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

      {!busy && warnings.length ? (
        <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
          {warnings.slice(0, 200).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
