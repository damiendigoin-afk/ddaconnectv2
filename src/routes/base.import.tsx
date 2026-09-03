import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchSites } from "@/lib/refbase";
import { analyze, type Analysis } from "@/lib/winmotor/analyze";
import { BATCH_SIZE, emptyCounters, ingestBatch, type IngestCounters } from "@/lib/winmotor/ingest";
import { parseFile, type ParsedFile } from "@/lib/winmotor/parse";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/base/import")({
  head: () => ({
    meta: [
      { title: "Import Winmotor — DDA Connect" },
      { name: "description", content: "Importer un export Winmotor (CSV ou XLSX) dans le référentiel clients et véhicules DDA Connect." },
      { property: "og:title", content: "Import Winmotor — DDA Connect" },
      { property: "og:description", content: "Analyse puis import d'un export Winmotor." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportPage,
});

type Step = "file" | "analysis" | "running" | "done";

function ImportPage() {
  const { isManager, displayName, user } = useAuth();
  const navigate = useNavigate();
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });

  const [step, setStep] = useState<Step>("file");
  const [siteId, setSiteId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [counters, setCounters] = useState<IngestCounters | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isManager) {
    return (
      <AppShell title="Import Winmotor" back={{ to: "/base" }}>
        <p className="card-surface p-5 text-sm text-muted-foreground">Import réservé aux managers.</p>
      </AppShell>
    );
  }

  const defaultSite = sites?.find((s) => s.is_default)?.id ?? sites?.[0]?.id ?? "";
  const effectiveSite = siteId || defaultSite;

  async function onFile(f: File) {
    setBusy(true);
    setError(null);
    try {
      const p = await parseFile(f);
      if (!p.rows.length) throw new Error("Aucune ligne exploitable dans le fichier.");
      setFile(f);
      setParsed(p);
      setAnalysis(analyze(f.name, p.headers, p.rows, p.encoding, p.delimiter));
      setStep("analysis");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lecture impossible");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!parsed || !file || !analysis) return;
    setStep("running");
    setBusy(true);
    setError(null);
    const c = emptyCounters();
    setCounters({ ...c });
    try {
      const { data: imp, error: impErr } = await supabase
        .from("imports")
        .insert({
          site_id: effectiveSite || null,
          file_name: file.name,
          file_size: file.size,
          status: "running",
          total_rows: parsed.rows.length,
          total_columns: parsed.headers.length,
          analysis: analysis as never,
          created_by: user?.id ?? null,
          created_by_name: displayName || null,
        } as never)
        .select("id")
        .single();
      if (impErr) throw impErr;
      setImportId(imp.id);

      for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
        await ingestBatch({
          importId: imp.id,
          siteId: effectiveSite || null,
          headers: parsed.headers,
          rows: parsed.rows.slice(i, i + BATCH_SIZE),
          startRowNumber: i + 2,
          counters: c,
        });
        setCounters({ ...c });
        setProgress(Math.round((c.processed / parsed.rows.length) * 100));
        await supabase
          .from("imports")
          .update({
            processed_rows: c.processed,
            customers_created: c.customersCreated,
            customers_updated: c.customersUpdated,
            vehicles_created: c.vehiclesCreated,
            vehicles_updated: c.vehiclesUpdated,
            relations_created: c.relationsCreated,
            contacts_imported: c.contactsImported,
            addresses_imported: c.addressesImported,
            mileages_imported: c.mileagesImported,
            duplicates_avoided: c.duplicatesAvoided,
            anomalies: c.errors,
          } as never)
          .eq("id", imp.id);
      }

      await supabase
        .from("imports")
        .update({ status: "completed", completed_at: new Date().toISOString() } as never)
        .eq("id", imp.id);
      setStep("done");
      toast.success("Import terminé");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur pendant l'import");
      if (importId) {
        await supabase.from("imports").update({ status: "failed" } as never).eq("id", importId);
      }
      setStep("analysis");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Import Winmotor" subtitle={file?.name} back={{ to: "/base" }}>
      <div className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-xl border-2 border-status-defect bg-card p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-defect" />
            <span>{error}</span>
          </div>
        ) : null}

        {step === "file" ? (
          <>
            <div className="card-surface space-y-3 p-4">
              <label className="block text-xs font-bold uppercase text-muted-foreground">Site / établissement</label>
              <select
                value={effectiveSite}
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full rounded-xl border-2 border-border bg-card px-3 py-3 text-base"
              >
                {(sites ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Toutes les données importées seront rattachées à ce site.
              </p>
            </div>

            <label className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-card px-4 py-10 text-center">
              {busy ? (
                <Loader2 className="h-8 w-8 animate-spin text-brand" />
              ) : (
                <FileSpreadsheet className="h-8 w-8 text-brand" />
              )}
              <span className="text-base font-extrabold uppercase">Choisir un fichier</span>
              <span className="text-xs text-muted-foreground">CSV Winmotor (séparateur « ; », CP1252) ou XLSX</span>
              <input
                type="file"
                accept=".csv,.txt,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
          </>
        ) : null}

        {step === "analysis" && analysis ? (
          <>
            <div className="card-surface space-y-3 p-4">
              <div className="text-sm font-bold uppercase">Analyse du fichier</div>
              <div className="text-xs text-muted-foreground">
                {analysis.fileName} — encodage {analysis.encoding}
                {analysis.delimiter && analysis.delimiter !== "xlsx" ? ` — séparateur « ${analysis.delimiter} »` : ""}
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Lignes lues" value={analysis.totalRows} />
                <Stat label="Lignes valides" value={analysis.validRows} />
                <Stat label="Lignes ignorées" value={analysis.ignoredRows} />
                <Stat label="Colonnes détectées" value={analysis.totalColumns} />
                <Stat label="Clients détectés" value={analysis.customers} />
                <Stat label="Véhicules détectés" value={analysis.vehicles} />
                <Stat label="Immatriculations" value={analysis.registrations} />
                <Stat label="VIN disponibles" value={analysis.vins} />
                <Stat label="Emails disponibles" value={analysis.emails} />
                <Stat label="Téléphones disponibles" value={analysis.phones} />
                <Stat label="Kilométrages" value={analysis.mileages} />
                <Stat label="Doublons potentiels" value={analysis.duplicateVehicles + analysis.duplicateCustomers} />
                <Stat label="Lignes en anomalie" value={analysis.anomalies} />
              </dl>
              {analysis.alerts.length ? (
                <div className="space-y-1 rounded-lg border-2 border-status-watch p-3 text-xs">
                  <p className="font-extrabold uppercase text-status-watch">Alertes données</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {analysis.alerts.map((a) => (
                      <li key={a.kind}>
                        {a.label} — {a.count} ligne(s){a.sample ? ` · ${a.sample}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground">
                    Ces alertes n'empêchent pas l'import : les champs absents restent inconnus.
                  </p>
                </div>
              ) : null}
              {analysis.anomalySamples.length ? (
                <ul className="space-y-1 rounded-lg bg-secondary p-3 text-xs text-muted-foreground">
                  {analysis.anomalySamples.slice(0, 5).map((a) => (
                    <li key={a.row}>
                      Ligne {a.row} : {a.errors.join(", ")}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <button
              onClick={() => void runImport()}
              disabled={busy}
              className="w-full rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
            >
              <Upload className="mr-2 inline h-5 w-5" />
              Préparer et lancer l'import
            </button>
            <button
              onClick={() => {
                setStep("file");
                setParsed(null);
                setAnalysis(null);
              }}
              className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-sm font-bold uppercase"
            >
              Changer de fichier
            </button>
          </>
        ) : null}

        {step === "running" && counters ? (
          <div className="card-surface space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold uppercase">
              <Loader2 className="h-4 w-4 animate-spin text-brand" /> Import en cours — {progress}%
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-brand transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {counters.processed.toLocaleString("fr-FR")} / {analysis?.totalRows.toLocaleString("fr-FR")} lignes traitées.
              Ne fermez pas cette page.
            </p>
          </div>
        ) : null}

        {step === "done" && counters ? (
          <>
            <div className="card-surface space-y-3 p-4">
              <div className="flex items-center gap-2 text-base font-extrabold uppercase">
                <CheckCircle2 className="h-5 w-5 text-status-ok" /> Import terminé
              </div>
              <div className="grid grid-cols-2 gap-2">
                <BigStat label="Importées" value={counters.imported} tone="ok" />
                <BigStat label="À corriger" value={counters.errors} tone="error" />
                <BigStat label="Doublons" value={counters.duplicates} tone="neutral" />
                <BigStat label="Ignorées" value={counters.skipped} tone="neutral" />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="Clients créés" value={counters.customersCreated} />
                <Stat label="Clients mis à jour" value={counters.customersUpdated} />
                <Stat label="Véhicules créés" value={counters.vehiclesCreated} />
                <Stat label="Véhicules mis à jour" value={counters.vehiclesUpdated} />
                <Stat label="Relations client/véhicule" value={counters.relationsCreated} />
                <Stat label="Coordonnées importées" value={counters.contactsImported} />
                <Stat label="Adresses importées" value={counters.addressesImported} />
                <Stat label="Kilométrages importés" value={counters.mileagesImported} />
                <Stat label="Doublons évités" value={counters.duplicatesAvoided} />
              </dl>
            </div>
            {importId && counters.errors > 0 ? (
              <Link
                to="/base/corrections/$importId"
                params={{ importId }}
                className="block w-full rounded-xl bg-status-defect px-4 py-4 text-center text-base font-extrabold uppercase text-white"
              >
                Corriger les {counters.errors.toLocaleString("fr-FR")} lignes en erreur
              </Link>
            ) : null}
            {importId ? (
              <Link
                to="/base/historique/$importId"
                params={{ importId }}
                className="block w-full rounded-xl bg-brand px-4 py-4 text-center text-base font-extrabold uppercase text-brand-foreground"
              >
                Voir le rapport d'import
              </Link>
            ) : null}
            <button
              onClick={() => void navigate({ to: "/base" })}
              className="w-full rounded-xl border-2 border-border bg-card px-4 py-3 text-sm font-bold uppercase"
            >
              Retour à la base
            </button>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-2">
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="text-lg font-extrabold">{value.toLocaleString("fr-FR")}</dd>
    </div>
  );
}

function BigStat({ label, value, tone }: { label: string; value: number; tone: "ok" | "error" | "neutral" }) {
  const toneClass =
    tone === "ok" ? "text-status-ok" : tone === "error" ? "text-status-defect" : "text-foreground";
  return (
    <div className="rounded-xl border-2 border-border bg-card px-3 py-3 text-center">
      <dd className={`text-3xl font-extrabold ${toneClass}`}>{value.toLocaleString("fr-FR")}</dd>
      <dt className="mt-1 text-[11px] font-bold uppercase text-muted-foreground">{label}</dt>
    </div>
  );
}
