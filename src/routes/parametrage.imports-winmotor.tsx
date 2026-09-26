import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge, btnGhost, btnPrimary, usePartsCtx, WriteSiteSelect } from "@/components/parts/PartsUi";
import { listBatches, listRejects, prepareFile, runImport, type Prepared } from "@/lib/winmotor/invoice-import";
import type { ImportKind } from "@/lib/winmotor/invoices";

export const Route = createFileRoute("/parametrage/imports-winmotor")({
  head: () => ({
    meta: [
      { title: "Imports WinMotor — DDA Connect" },
      { name: "description", content: "Import des exports WinMotor : entêtes de factures et détail facturation, par site." },
      { property: "og:title", content: "Imports WinMotor — DDA Connect" },
      { property: "og:description", content: "Import des factures WinMotor par site." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportsPage,
});

const KIND_LABEL: Record<ImportKind, string> = { headers: "Entêtes de factures", details: "Détail facturation" };

function ImportsPage() {
  const { writeSite } = usePartsCtx();
  const [site, setSite] = useState<string | null>(writeSite);
  return (
    <AppShell title="Imports WinMotor" subtitle="Paramétrage" back={{ to: "/parametrage" }}>
      <div className="space-y-4">
        <div className="card-surface space-y-2 p-4">
          <WriteSiteSelect value={site} onChange={setSite} />
          <p className="text-xs text-muted-foreground">Les exports WinMotor ne contiennent pas la société : choisissez-la explicitement pour chaque import.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <DropZone kind="headers" site={site} />
          <DropZone kind="details" site={site} />
        </div>
        <History />
      </div>
    </AppShell>
  );
}

function DropZone({ kind, site }: { kind: ImportKind; site: string | null }) {
  const { actor, siteName } = usePartsCtx();
  const qc = useQueryClient();
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!site) return void toast.error("Choisissez d'abord le site / la société.");
    setBusy(true); setPrep(null);
    try {
      const p = await prepareFile(file, site, kind);
      setPrep(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lecture impossible");
    } finally { setBusy(false); }
  }
  async function validate() {
    if (!prep || !site) return;
    setBusy(true);
    try {
      const r = await runImport(prep, site, actor.name, (done, total) => setProgress({ done, total }));
      if (r.alreadyImported) toast.info("Ce fichier exact a déjà été importé pour ce site : rien n'a été recréé.");
      else toast.success(`Import terminé : ${r.created} nouvelle(s), ${r.updated} mise(s) à jour, ${r.unchanged} inchangée(s).`);
      setPrep(null); setProgress(null);
      qc.invalidateQueries({ queryKey: ["wm-batches"] });
    } catch (e) {
      toast.error(`Import interrompu : ${e instanceof Error ? e.message : "erreur"}. Relancer le même fichier reprend sans doublon.`);
    } finally { setBusy(false); }
  }
  const p = prep?.parsed;
  return (
    <div className="card-surface space-y-3 p-4">
      <h2 className="text-sm font-extrabold uppercase">{KIND_LABEL[kind]}</h2>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files[0]); }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm ${drag ? "border-brand bg-brand/10" : "border-border"}`}
      >
        {busy && !progress ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6 text-brand" />}
        <span>Glisser le fichier CSV ici ou <u>choisir un fichier</u></span>
        <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {p ? (
        <div className="space-y-1 text-xs">
          <div><b>{prep!.file.name}</b> · {(prep!.file.size / 1048576).toFixed(1)} Mo · {p.encoding}</div>
          <div className="break-all text-muted-foreground">Empreinte {prep!.hash.slice(0, 16)}…</div>
          {p.kind !== kind ? <Badge tone="bad">Ce fichier ressemble à « {KIND_LABEL[p.kind]} »</Badge> : null}
          {p.missing.length ? (
            <div className="rounded-lg border-2 border-destructive p-2">
              Colonnes obligatoires introuvables : {p.missing.join(", ")}. Colonnes lues : {p.headers.join(" | ")}
            </div>
          ) : (
            <>
              <div>Société : <b>{siteName(site)}</b></div>
              <div>{p.rowsTotal.toLocaleString("fr-FR")} lignes · {(kind === "details" ? p.invoices.length : p.headerRows.length).toLocaleString("fr-FR")} factures · {p.orCount.toLocaleString("fr-FR")} OR</div>
              <div>Dates présentes : {p.dateMin ?? "?"} → {p.dateMax ?? "?"} <span className="text-muted-foreground">(ne prouve pas que la période est complète)</span></div>
              <div>Montant HT {p.sumHt.toLocaleString("fr-FR")} €{kind === "headers" ? ` · TTC ${p.sumTtc.toLocaleString("fr-FR")} €` : " (hors en-têtes de forfait)"}</div>
              <div>Valeurs négatives : {p.negativeRows} · Lignes reconstruites : {p.recovered} · Rejets : {p.rejects.length}{p.duplicateInvoiceRows ? ` · Factures en double dans le fichier : ${p.duplicateInvoiceRows}` : ""}</div>
              {p.rejects.slice(0, 3).map((r) => <div key={r.line_no} className="truncate text-destructive">L{r.line_no} : {r.reason} — {r.raw_text}</div>)}
              <details open className="rounded-lg border-2 border-border p-2"><summary className="cursor-pointer font-bold">Correspondance des colonnes (à vérifier)</summary>{Object.entries(p.map).map(([k, i]) => <div key={k}>{k} ← « {p.headers[i]} »</div>)}<div className="text-muted-foreground">Colonnes du fichier non utilisées : {p.headers.filter((_, i) => !Object.values(p.map).includes(i)).join(" | ") || "aucune"}</div></details>
              <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={mapOk} onChange={(e) => setMapOk(e.target.checked)} />J'ai vérifié la correspondance des colonnes</label>
              {prep!.file.size > 30 * 1048576 ? <Badge tone="warn">Gros fichier : lecture complète en mémoire du navigateur (ordinateur conseillé, pas de mobile)</Badge> : null}
              {prep!.existing ? <Badge tone="warn">{prep!.existing.status === "done" ? `Déjà importé le ${new Date(prep!.existing.created_at).toLocaleString("fr-FR")}` : "Import précédent interrompu : la validation le reprend"}</Badge> : null}
              {progress ? <div className="font-bold">Import en cours : {progress.done.toLocaleString("fr-FR")} / {progress.total.toLocaleString("fr-FR")}</div> : null}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button className={btnGhost} onClick={() => setPrep(null)} disabled={busy}>Annuler</button>
                <button className={btnPrimary} onClick={validate} disabled={busy || p.kind !== kind || !mapOk}>Valider l'import</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function History() {
  const { siteName } = usePartsCtx();
  const q = useQuery({ queryKey: ["wm-batches"], queryFn: listBatches });
  const [open, setOpen] = useState<string | null>(null);
  const rej = useQuery({ queryKey: ["wm-rejects", open], enabled: !!open, queryFn: () => listRejects(open!) });
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Historique des imports</h2>
      {q.data && !q.data.length ? <p className="card-surface p-3 text-sm text-muted-foreground">Aucun import de factures pour l'instant.</p> : null}
      {(q.data ?? []).map((b) => (
        <div key={b.id} className="rounded-xl border-2 border-border bg-card p-3 text-xs">
          <div className="flex justify-between gap-2">
            <b>{KIND_LABEL[b.import_type as ImportKind]} · {siteName(b.site_id)}</b>
            <Badge tone={b.status === "done" ? "ok" : b.status === "failed" ? "bad" : "warn"}>{b.status === "done" ? "Terminé" : b.status === "failed" ? "Interrompu" : "En cours"}</Badge>
          </div>
          <div className="text-muted-foreground">{b.file_name} · {new Date(b.created_at).toLocaleString("fr-FR")} · {b.created_by_name} · empreinte {b.file_hash.slice(0, 10)}…</div>
          <div>Période observée {b.date_min ?? "?"} → {b.date_max ?? "?"} · {b.rows_total} lignes · {b.invoices_seen} factures ({b.invoices_created} nouvelles, {b.invoices_updated} mises à jour, {b.invoices_unchanged} inchangées){b.lines_inserted ? ` · ${b.lines_inserted} lignes` : ""}</div>
          {b.rows_rejected ? <button className="underline" onClick={() => setOpen(open === b.id ? null : b.id)}>{b.rows_rejected} rejet(s) — voir</button> : null}
          {open === b.id ? (rej.data ?? []).map((r, i) => <div key={i} className="truncate text-destructive">L{r.line_no} : {r.reason} — {r.raw_text}</div>) : null}
        </div>
      ))}
    </section>
  );
}
