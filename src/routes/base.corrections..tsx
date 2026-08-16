import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { emptyCounters, reingestRows } from "@/lib/winmotor/ingest";

export const Route = createFileRoute("/base/corrections/")({
  head: () => ({
    meta: [
      { title: "Lignes à corriger — DDA Connect" },
      {
        name: "description",
        content: "Corriger, ignorer ou forcer les lignes en erreur d'un import Winmotor avant réingestion.",
      },
      { property: "og:title", content: "Lignes à corriger — DDA Connect" },
      { property: "og:description", content: "Correction des lignes d'import en erreur." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CorrectionsPage,
});

type ImportRow = {
  id: string;
  row_number: number;
  source_vehicle_id: string | null;
  source_customer_id: string | null;
  raw_data: Record<string, string>;
  corrected_data: Record<string, string> | null;
  processing_status: string;
  processing_errors: string[] | null;
};

async function fetchCorrections(importId: string) {
  const [{ data: imp }, { data: rows }] = await Promise.all([
    supabase.from("imports").select("*").eq("id", importId).maybeSingle(),
    supabase
      .from("import_rows")
      .select("id, row_number, source_vehicle_id, source_customer_id, raw_data, corrected_data, processing_status, processing_errors")
      .eq("import_id", importId)
      .in("processing_status", ["error"])
      .order("row_number")
      .limit(500),
  ]);
  return { imp, rows: (rows ?? []) as unknown as ImportRow[] };
}

function CorrectionsPage() {
  const { importId } = Route.useParams();
  const { isManager, user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["corrections", importId],
    queryFn: () => fetchCorrections(importId),
    enabled: isManager,
  });
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reimporting, setReimporting] = useState(false);

  if (!isManager) {
    return (
      <AppShell title="Lignes à corriger" back={{ to: "/base/historique/$importId", params: { importId } }}>
        <p className="card-surface p-5 text-sm text-muted-foreground">Réservé aux managers.</p>
      </AppShell>
    );
  }

  const rows = data?.rows ?? [];

  function fieldValue(row: ImportRow, field: string): string {
    const local = edits[row.id]?.[field];
    if (local !== undefined) return local;
    return (row.corrected_data?.[field] ?? row.raw_data?.[field] ?? "") as string;
  }

  function setField(rowId: string, field: string, value: string) {
    setEdits((prev) => ({ ...prev, [rowId]: { ...prev[rowId], [field]: value } }));
  }

  function fieldsForRow(row: ImportRow): string[] {
    // Champs propres à la ligne source susceptibles d'être corrigés.
    const candidates = Object.keys(row.raw_data ?? {});
    return candidates.slice(0, 40);
  }

  async function saveCorrection(row: ImportRow) {
    setBusyId(row.id);
    try {
      const merged = { ...(row.corrected_data ?? {}), ...(edits[row.id] ?? {}) };
      const { error } = await supabase
        .from("import_rows")
        .update({ corrected_data: merged as never, resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null } as never)
        .eq("id", row.id);
      if (error) throw error;
      toast.success(`Ligne ${row.row_number} enregistrée`);
      await qc.invalidateQueries({ queryKey: ["corrections", importId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
    } finally {
      setBusyId(null);
    }
  }

  async function markStatus(row: ImportRow, status: "skipped" | "fixed") {
    setBusyId(row.id);
    try {
      const merged = { ...(row.corrected_data ?? {}), ...(edits[row.id] ?? {}) };
      const { error } = await supabase
        .from("import_rows")
        .update({
          processing_status: status,
          corrected_data: merged as never,
          resolved_at: new Date().toISOString(),
          resolved_by: user?.id ?? null,
        } as never)
        .eq("id", row.id);
      if (error) throw error;
      toast.success(status === "skipped" ? `Ligne ${row.row_number} ignorée` : `Ligne ${row.row_number} forcée`);
      await qc.invalidateQueries({ queryKey: ["corrections", importId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function reimportFixed() {
    if (!data?.imp) return;
    setReimporting(true);
    try {
      const { data: toFix } = await supabase
        .from("import_rows")
        .select("id, row_number, raw_data, corrected_data")
        .eq("import_id", importId)
        .in("processing_status", ["fixed"])
        .not("corrected_data", "is", null);
      const list = (toFix ?? []) as unknown as { id: string; row_number: number; raw_data: Record<string, string>; corrected_data: Record<string, string> | null }[];
      if (!list.length) {
        toast.info("Aucune ligne corrigée à réimporter");
        return;
      }
      const headers = Object.keys(data.imp.analysis && typeof data.imp.analysis === "object" ? (data.imp.analysis as { totalColumns?: number }) : {}).length
        ? []
        : [];
      const allHeaders = Array.from(new Set(list.flatMap((r) => Object.keys({ ...r.raw_data, ...(r.corrected_data ?? {}) }))));
      void headers;
      const counters = emptyCounters();
      await reingestRows({
        importId,
        siteId: data.imp.site_id,
        headers: allHeaders,
        rows: list,
        counters,
      });
      await supabase
        .from("imports")
        .update({
          processed_rows: data.imp.processed_rows + counters.processed,
          customers_created: data.imp.customers_created + counters.customersCreated,
          customers_updated: data.imp.customers_updated + counters.customersUpdated,
          vehicles_created: data.imp.vehicles_created + counters.vehiclesCreated,
          vehicles_updated: data.imp.vehicles_updated + counters.vehiclesUpdated,
          relations_created: data.imp.relations_created + counters.relationsCreated,
          contacts_imported: data.imp.contacts_imported + counters.contactsImported,
          addresses_imported: data.imp.addresses_imported + counters.addressesImported,
          mileages_imported: data.imp.mileages_imported + counters.mileagesImported,
          duplicates_avoided: data.imp.duplicates_avoided + counters.duplicatesAvoided,
        } as never)
        .eq("id", importId);
      toast.success(`${counters.imported.toLocaleString("fr-FR")} ligne(s) réimportée(s)`);
      await qc.invalidateQueries({ queryKey: ["corrections", importId] });
      await qc.invalidateQueries({ queryKey: ["import", importId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur pendant la réimportation");
    } finally {
      setReimporting(false);
    }
  }

  return (
    <AppShell
      title="Lignes à corriger"
      subtitle={data?.imp?.file_name}
      back={{ to: "/base/historique/$importId", params: { importId } }}
    >
      <div className="space-y-4">
        <button
          onClick={() => void reimportFixed()}
          disabled={reimporting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-60"
        >
          {reimporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
          Réimporter les lignes corrigées
        </button>

        {isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {!isLoading && !rows.length ? (
          <div className="card-surface flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-status-ok" /> Aucune ligne en erreur restante.
          </div>
        ) : null}

        {rows.map((row) => (
          <div key={row.id} className="card-surface space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-extrabold">Ligne {row.row_number}</span>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                {row.source_vehicle_id ? `Véhicule ${row.source_vehicle_id}` : row.source_customer_id ? `Client ${row.source_customer_id}` : "Non identifié"}
              </span>
            </div>

            <ul className="space-y-1 rounded-lg bg-secondary/60 p-3 text-xs text-status-defect">
              {(row.processing_errors ?? []).map((err, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{err}</span>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-1 gap-2">
              {fieldsForRow(row).map((field) => (
                <label key={field} className="block text-xs">
                  <span className="mb-1 block font-bold uppercase text-muted-foreground">{field}</span>
                  <input
                    value={fieldValue(row, field)}
                    onChange={(e) => setField(row.id, field, e.target.value)}
                    className="w-full rounded-lg border-2 border-border bg-card px-2 py-2 text-sm"
                  />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void saveCorrection(row)}
                disabled={busyId === row.id}
                className="rounded-lg bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60"
              >
                Corriger
              </button>
              <button
                onClick={() => void markStatus(row, "fixed")}
                disabled={busyId === row.id}
                className="rounded-lg border-2 border-brand bg-card px-3 py-3 text-xs font-extrabold uppercase text-brand disabled:opacity-60"
              >
                Revalider
              </button>
              <button
                onClick={() => void markStatus(row, "skipped")}
                disabled={busyId === row.id}
                className="rounded-lg border-2 border-border bg-card px-3 py-3 text-xs font-bold uppercase disabled:opacity-60"
              >
                Ignorer
              </button>
              <button
                onClick={() => void markStatus(row, "fixed")}
                disabled={busyId === row.id}
                className="rounded-lg border-2 border-status-defect bg-card px-3 py-3 text-xs font-bold uppercase text-status-defect disabled:opacity-60"
              >
                Utiliser malgré l'alerte
              </button>
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
