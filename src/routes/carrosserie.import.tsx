import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Counter } from "@/components/bits";
import { useAuth } from "@/lib/auth";
import { parseFile } from "@/lib/winmotor/parse";
import { buildHeaderIndex, mapMissionRow, type MissionFix, type RawRow } from "@/lib/missions/mapping";
import {
  applyConflict,
  ingestMissions,
  type MissionConflict,
  type MissionErrorRow,
  type MissionIngestResult,
} from "@/lib/missions/ingest";

export const Route = createFileRoute("/carrosserie/import")({
  head: () => ({
    meta: [
      { title: "Import Suivi Missions — DDA Connect" },
      {
        name: "description",
        content:
          "Initialiser le module Carrosserie depuis le fichier Suivi Missions : analyse, contrôle des conflits et import tolérant aux erreurs.",
      },
      { property: "og:title", content: "Import Suivi Missions — DDA Connect" },
      { property: "og:description", content: "Import des dossiers carrosserie depuis Excel ou CSV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportMissions,
});

type Problem = { index: number; row: number; errors: string[]; fix: MissionFix };

type Preview = {
  fileName: string;
  headers: string[];
  rows: RawRow[];
  ok: number;
  toFix: number;
  problems: Problem[];
};

function ImportMissions() {
  const navigate = useNavigate();
  const { isManager, profile } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MissionIngestResult | null>(null);
  const [fixes, setFixes] = useState<Record<number, MissionFix>>({});

  if (!isManager) {
    return (
      <AppShell title="Import Suivi Missions" back={{ to: "/carrosserie" }}>
        <p className="card-surface p-4 text-sm">Réservé aux managers.</p>
      </AppShell>
    );
  }

  async function onFile(f: File) {
    setBusy(true);
    setResult(null);
    try {
      const parsed = await parseFile(f);
      const index = buildHeaderIndex(parsed.headers);
      let ok = 0;
      const problems: Problem[] = [];
      parsed.rows.forEach((r, i) => {
        const m = mapMissionRow(r as RawRow, index);
        if (m.errors.length) {
          problems.push({
            index: i,
            row: i + 2,
            errors: m.errors,
            fix: { plate: m.plate, missionDate: m.missionDate ?? "", customerName: m.customerName },
          });
        } else ok++;
      });
      setFixes({});
      setFile(f);
      setPreview({
        fileName: f.name,
        headers: parsed.headers,
        rows: parsed.rows as RawRow[],
        ok,
        toFix: problems.length,
        problems,
      });
    } catch (e) {
      console.error(e);
      toast.error("Fichier illisible. Formats acceptés : .xlsx, .xls, .csv");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!preview || !file) return;
    setBusy(true);
    setProgress(0);
    try {
      const res = await ingestMissions(
        { name: file.name, size: file.size },
        preview.headers,
        preview.rows,
        profile?.site_id ?? null,
        (done, total) => setProgress(Math.round((done / total) * 100)),
        fixes,
      );
      setResult(res);
      toast.success(`${res.counters.imported} créés · ${res.counters.updated} mis à jour`);
    } catch (e) {
      console.error(e);
      toast.error("Import interrompu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Import Suivi Missions" subtitle="Initialisation Carrosserie" back={{ to: "/carrosserie" }}>
      {!preview ? (
        <label className="card-surface flex cursor-pointer flex-col items-center gap-3 p-8 text-center">
          {busy ? (
            <Loader2 className="h-10 w-10 animate-spin text-brand" />
          ) : (
            <FileSpreadsheet className="h-10 w-10 text-brand" />
          )}
          <span className="text-base font-extrabold uppercase">Choisir le fichier</span>
          <span className="text-xs text-muted-foreground">SUIVI MISSIONS CARROSSERIE — .xlsx, .xls ou .csv</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}

      {preview && !result ? (
        <div className="space-y-4">
          <section className="card-surface p-4">
            <h2 className="text-sm font-extrabold uppercase">{preview.fileName}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Counter label="Lignes" value={preview.rows.length} />
              <Counter label="Prêtes" value={preview.ok} />
              <Counter label="À corriger" value={preview.toFix} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Les lignes en erreur n'interrompent pas l'import : elles sont conservées pour correction.
            </p>
          </section>

          {preview.problems.length ? (
            <section className="card-surface space-y-3 p-4">
              <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Informations à compléter
              </h3>
              <p className="text-xs text-muted-foreground">
                Corrigez ici ce qui manque (immatriculation, date de mission, client) puis validez : rien n'est à
                recommencer.
              </p>
              {preview.problems.map((p) => (
                <FixForm
                  key={p.index}
                  errors={p.errors}
                  rowNumber={p.row}
                  value={fixes[p.index] ?? p.fix}
                  onChange={(v) => setFixes((prev) => ({ ...prev, [p.index]: v }))}
                />
              ))}
            </section>
          ) : null}

          {busy ? (
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setPreview(null);
                setFile(null);
              }}
              className="rounded-xl border-2 border-border bg-card px-4 py-4 text-sm font-extrabold uppercase"
            >
              Changer de fichier
            </button>
            <button
              onClick={() => void run()}
              disabled={busy}
              className="rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              {busy ? `Import ${progress}%` : preview.problems.length ? "Valider et importer" : "Lancer l'import"}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <ResultView
          result={result}
          onRetry={async (rows, rowFixes) => {
            if (!preview || !file) return;
            const res = await ingestMissions(
              { name: `${file.name} (corrections)`, size: file.size },
              preview.headers,
              rows,
              profile?.site_id ?? null,
              undefined,
              rowFixes,
            );
            setResult(res);
            toast.success(`${res.counters.imported} créés · ${res.counters.updated} mis à jour`);
          }}
          onDone={() => void navigate({ to: "/carrosserie" })}
        />
      ) : null}
    </AppShell>
  );
}

function ResultView({
  result,
  onDone,
  onRetry,
}: {
  result: MissionIngestResult;
  onDone: () => void;
  onRetry: (rows: RawRow[], fixes: Record<number, MissionFix>) => Promise<void>;
}) {
  const [conflicts, setConflicts] = useState<MissionConflict[]>(result.conflicts);

  async function keepFile(c: MissionConflict) {
    await applyConflict(c);
    setConflicts((prev) => prev.filter((x) => x !== c));
    toast.success("Valeur du fichier appliquée.");
  }

  return (
    <div className="space-y-4">
      <section className="card-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-extrabold uppercase">
          <Check className="h-4 w-4 text-emerald-600" /> Import terminé
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Counter label="Dossiers créés" value={result.counters.imported} />
          <Counter label="Mis à jour" value={result.counters.updated} />
          <Counter label="À corriger" value={result.counters.toFix} />
          <Counter label="Doublons évités" value={result.counters.duplicates} />
          <Counter label="Conflits" value={conflicts.length} />
        </div>
      </section>

      {conflicts.length ? (
        <section className="space-y-2">
          <h3 className="px-1 text-sm font-extrabold uppercase">Conflits à trancher</h3>
          {conflicts.map((c, i) => (
            <div key={`${c.caseId}-${c.field}-${i}`} className="card-surface p-4">
              <div className="text-xs text-muted-foreground">
                Ligne {c.rowNumber} · {c.plate}
              </div>
              <div className="text-sm font-bold">{c.label}</div>
              <div className="mt-2 space-y-1 text-sm">
                <div className="rounded-lg bg-secondary px-3 py-2">Application : {c.appValue}</div>
                <div className="rounded-lg bg-amber-100 px-3 py-2 text-amber-950">Fichier : {c.fileValue}</div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConflicts((prev) => prev.filter((x) => x !== c))}
                  className="rounded-lg border-2 border-border px-3 py-2 text-xs font-extrabold uppercase"
                >
                  Garder l'app
                </button>
                <button
                  onClick={() => void keepFile(c)}
                  className="rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground"
                >
                  Prendre le fichier
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {result.errorRows.length ? <ErrorRows rows={result.errorRows} onRetry={onRetry} /> : null}

      <button
        onClick={onDone}
        className="w-full rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground"
      >
        Voir les dossiers
      </button>
    </div>
  );
}

function FixForm({
  rowNumber,
  errors,
  value,
  onChange,
}: {
  rowNumber: number;
  errors: string[];
  value: MissionFix;
  onChange: (v: MissionFix) => void;
}) {
  return (
    <div className="rounded-xl border-2 border-border p-3">
      <div className="text-xs font-bold uppercase text-muted-foreground">Ligne {rowNumber}</div>
      <ul className="mt-1 space-y-0.5 text-xs text-amber-700">
        {errors.map((e, i) => (
          <li key={i}>⚠ {e}</li>
        ))}
      </ul>
      <div className="mt-2 space-y-2">
        <label className="block">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Immatriculation</span>
          <input
            value={value.plate ?? ""}
            onChange={(e) => onChange({ ...value, plate: e.target.value.toUpperCase() })}
            placeholder="AB-123-CD"
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-bold uppercase"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Date de mission</span>
          <input
            type="date"
            value={value.missionDate ?? ""}
            onChange={(e) => onChange({ ...value, missionDate: e.target.value })}
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm font-bold"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Client</span>
          <input
            value={value.customerName ?? ""}
            onChange={(e) => onChange({ ...value, customerName: e.target.value })}
            className="w-full rounded-lg border-2 border-border bg-card px-3 py-2 text-sm"
          />
        </label>
      </div>
    </div>
  );
}

function ErrorRows({
  rows,
  onRetry,
}: {
  rows: MissionErrorRow[];
  onRetry: (rows: RawRow[], fixes: Record<number, MissionFix>) => Promise<void>;
}) {
  const [fixes, setFixes] = useState<Record<number, MissionFix>>(
    Object.fromEntries(rows.map((r, i) => [i, r.fix])),
  );
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      await onRetry(rows.map((r) => r.raw), fixes);
    } catch (e) {
      console.error(e);
      toast.error("Réimport impossible. Vérifiez les informations saisies.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="px-1 text-sm font-extrabold uppercase">Lignes à corriger ({rows.length})</h3>
      {rows.map((r, i) => (
        <div key={`${r.rowNumber}-${r.id}`} className="card-surface p-4">
          <div className="mb-1 truncate text-xs text-muted-foreground">{r.identity}</div>
          <FixForm
            rowNumber={r.rowNumber}
            errors={r.errors}
            value={fixes[i] ?? r.fix}
            onChange={(v) => setFixes((prev) => ({ ...prev, [i]: v }))}
          />
        </div>
      ))}
      <button
        onClick={() => void retry()}
        disabled={busy}
        className="w-full rounded-xl bg-brand px-4 py-4 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-60"
      >
        {busy ? "Import…" : "Valider et importer"}
      </button>
      <p className="px-1 text-xs text-muted-foreground">
        Les dossiers déjà créés seront simplement mis à jour : aucun doublon.
      </p>
    </section>
  );
}
