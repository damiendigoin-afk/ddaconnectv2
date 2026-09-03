import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileCheck2, PencilLine, Plus, Search, Truck } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge, Counter } from "@/components/bits";
import {
  COUNTER_LABELS,
  ageDays,
  computeReturnCounters,
  filterByCounter,
  isDraft,
  isUrgent,
  listReturns,
  needsReminder,
  pendingAmount,
  returnStatusLabel,
  returnStatusTone,
  returnTypeLabel,
  searchReturns,
  supplierSummaries,
} from "@/lib/returns";
import { listSuppliers } from "@/lib/suppliers";
import { formatPlate } from "@/lib/plate";
import { mediaUrl } from "@/lib/photo";

export const Route = createFileRoute("/magasin/")({
  head: () => ({
    meta: [
      { title: "Magasin — Retours pièces et avoirs — DDA Connect" },
      { name: "description", content: "Tableau de bord des retours fournisseurs : accords, expéditions, consignes, avoirs et litiges." },
      { property: "og:title", content: "Magasin — Retours pièces et avoirs" },
      { property: "og:description", content: "Pilotage complet des retours fournisseurs et des avoirs attendus." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StoreHub,
});

type Tab = "dossiers" | "fournisseurs";

function StoreHub() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("dossiers");
  const [counter, setCounter] = useState<string>("");
  const [query, setQuery] = useState("");

  const rows = useQuery({ queryKey: ["returns"], queryFn: listReturns });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const supplierName = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name ?? null;

  const all = rows.data ?? [];
  const drafts = useMemo(() => all.filter(isDraft), [all]);
  const list = useMemo(() => all.filter((r) => !isDraft(r)), [all]);
  const counters = useMemo(() => computeReturnCounters(list), [list]);
  const summaries = useMemo(() => supplierSummaries(list), [list]);

  const visible = useMemo(() => {
    const base = counter ? filterByCounter(list, counter) : list;
    return query.trim() ? searchReturns(base, query, supplierName) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, counter, query, suppliers.data]);

  return (
    <AppShell
      title="Magasin"
      subtitle="Retours fournisseurs, consignes et avoirs"
      back={{ to: "/" }}
      right={
        <Link to="/magasin/avoirs" aria-label="Avoirs" className="rounded-lg border border-border p-2 text-muted-foreground">
          <FileCheck2 className="h-4 w-4" />
        </Link>
      }
    >
      <button
        onClick={() => void navigate({ to: "/magasin/nouveau" })}
        className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-5 text-brand-foreground active:scale-[0.99]"
      >
        <Plus className="h-7 w-7" />
        <span className="flex-1 text-left text-lg font-extrabold uppercase tracking-wide">Nouveau retour</span>
      </button>

      <Link
        to="/factures-fournisseur"
        className="mt-2 flex w-full items-center gap-3 rounded-xl border-2 border-border px-4 py-4 active:scale-[0.99]"
      >
        <FileCheck2 className="h-6 w-6 text-brand" />
        <span className="flex-1 text-left text-sm font-extrabold uppercase tracking-wide">
          BL / Factures fournisseur
        </span>
      </Link>


      <div className="mt-3 flex items-center gap-2 rounded-xl border-2 border-border bg-card px-3 py-2">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Réf, BL, facture, pièce, plaque, OR, fournisseur, montant…"
          className="w-full bg-transparent py-1 text-sm outline-none"
        />
        {query ? (
          <button onClick={() => setQuery("")} className="text-xs font-bold uppercase text-muted-foreground">
            Effacer
          </button>
        ) : null}
      </div>

      {drafts.length ? (
        <div className="mt-4">
          <h2 className="px-1 pb-2 text-sm font-extrabold uppercase tracking-wide text-amber-700">
            Brouillons à terminer ({drafts.length})
          </h2>
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <DraftCard row={d} supplierName={supplierName(d.supplier_id)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        {(["dossiers", "fournisseurs"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl border-2 py-2 text-sm font-extrabold uppercase ${tab === t ? "border-brand bg-brand/10" : "border-border"}`}
          >
            {t === "dossiers" ? "Dossiers" : "Par fournisseur"}
          </button>
        ))}
      </div>

      {tab === "dossiers" ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {COUNTER_LABELS.map((c) => (
              <Counter
                key={c.key}
                label={c.label}
                value={c.money ? `${Math.round(counters[c.key]).toLocaleString("fr-FR")} €` : counters[c.key]}
                active={counter === c.key}
                onClick={() => setCounter(counter === c.key ? "" : c.key)}
              />
            ))}
          </div>

          <h2 className="px-1 pb-2 pt-5 text-sm font-extrabold uppercase tracking-wide">Retours ({visible.length})</h2>
          {rows.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : visible.length ? (
            <ul className="space-y-2">
              {visible.map((r) => (
                <li key={r.id}>
                  <Link to="/magasin/$returnId" params={{ returnId: r.id }} className="card-surface block p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold">{r.reference}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {supplierName(r.supplier_id) ?? "Fournisseur ?"} · {r.lines.length} ligne(s) · {ageDays(r.created_at)} j
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {returnTypeLabel(r.return_type)}
                          {r.bl_number ? ` · BL ${r.bl_number}` : ""}
                          {r.invoice_number ? ` · Facture ${r.invoice_number}` : ""}
                        </div>
                        {r.plate ? <div className="mt-1 plate-badge text-base">{formatPlate(r.plate)}</div> : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={returnStatusTone(r.status)}>{returnStatusLabel(r.status)}</Badge>
                        {isUrgent(r) ? <Badge tone="bg-red-200 text-red-950">Délai</Badge> : null}
                        {needsReminder(r) ? <Badge tone="bg-amber-200 text-amber-950">Relance</Badge> : null}
                        {pendingAmount(r) > 0 ? (
                          <span className="text-[11px] font-bold text-muted-foreground">{pendingAmount(r).toFixed(2)} €</span>
                        ) : null}
                        {r.tracking_number ? (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Truck className="h-3 w-3" /> {r.tracking_number}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun retour pour ce filtre.</p>
          )}
        </>
      ) : (
        <>
          <h2 className="px-1 pb-2 pt-5 text-sm font-extrabold uppercase tracking-wide">
            Fournisseurs concernés ({summaries.length})
          </h2>
          <ul className="space-y-2">
            {summaries.map((s) => (
              <li key={s.supplierId ?? "none"}>
                <button
                  onClick={() => {
                    setTab("dossiers");
                    setCounter("");
                    setQuery(supplierName(s.supplierId) ?? "");
                  }}
                  className="card-surface block w-full p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold">{supplierName(s.supplierId) ?? "Fournisseur non renseigné"}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.open} dossier(s) en cours · plus ancien {s.oldestDays} j
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-extrabold">{s.pendingAmount.toFixed(2)} €</div>
                      <div className="text-[11px] text-muted-foreground">
                        {s.depositPending > 0 ? `dont consignes ${s.depositPending.toFixed(0)} € · ` : ""}
                        {s.reminders} relance(s)
                      </div>
                      {s.disputes ? <Badge tone="bg-red-200 text-red-950">{s.disputes} litige(s)</Badge> : null}
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {summaries.length ? null : <p className="text-sm text-muted-foreground">Aucun dossier en cours.</p>}
          </ul>
        </>
      )}
    </AppShell>
  );
}

function DraftCard({
  row,
  supplierName,
}: {
  row: Awaited<ReturnType<typeof listReturns>>[number];
  supplierName: string | null;
}) {
  const [thumb, setThumb] = useState<string>("");
  const firstPhoto = row.photos?.[0];
  useMemo(() => {
    if (firstPhoto) void mediaUrl(firstPhoto).then(setThumb);
  }, [firstPhoto]);

  return (
    <Link to="/magasin/$returnId" params={{ returnId: row.id }} className="card-surface flex gap-3 p-3">
      {thumb ? (
        <img src={thumb} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <PencilLine className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-extrabold">{row.reference}</div>
        <div className="truncate text-xs text-muted-foreground">
          {row.created_by_name ?? "Auteur inconnu"} · créé le {new Date(row.created_at).toLocaleDateString("fr-FR")}
        </div>
        <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
          {row.plate ? <Badge>{formatPlate(row.plate)}</Badge> : null}
          {row.or_number ? <Badge>OR {row.or_number}</Badge> : null}
          {supplierName ? <Badge>{supplierName}</Badge> : null}
        </div>
      </div>
    </Link>
  );
}
