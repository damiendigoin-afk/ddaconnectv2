import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileCheck2, PencilLine, Plus, Truck } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Badge, Counter } from "@/components/bits";
import {
  computeReturnCounters,
  isDraft,
  isUrgent,
  listReturns,
  returnStatusLabel,
  returnStatusTone,
} from "@/lib/returns";
import { listSuppliers } from "@/lib/referentials";
import { formatPlate } from "@/lib/plate";
import { mediaUrl } from "@/lib/photo";

export const Route = createFileRoute("/magasin/")({
  head: () => ({
    meta: [
      { title: "Magasin — Retours pièces et avoirs — DDA Connect" },
      { name: "description", content: "Suivi des retours de pièces, expéditions fournisseurs, avoirs attendus et relances." },
      { property: "og:title", content: "Magasin — Retours pièces et avoirs" },
      { property: "og:description", content: "Demandes de retour, expéditions et réconciliation des avoirs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StoreHub,
});

const FILTERS = [
  { key: "a_preparer", label: "À préparer" },
  { key: "prepares", label: "Préparés" },
  { key: "urgences", label: "Urgences délai" },
  { key: "avoirs_attendus", label: "Avoirs attendus" },
  { key: "avoirs_partiels", label: "Avoirs partiels" },
  { key: "consignes", label: "Consignes" },
  { key: "litiges", label: "Litiges" },
  { key: "clotures", label: "Clôturés" },
] as const;

function StoreHub() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>("");
  const rows = useQuery({ queryKey: ["returns"], queryFn: listReturns });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const all = rows.data ?? [];
  const drafts = useMemo(() => all.filter(isDraft), [all]);
  const list = useMemo(() => all.filter((r) => !isDraft(r)), [all]);
  const counters = useMemo(() => computeReturnCounters(list), [list]);

  const visible = useMemo(() => {
    switch (filter) {
      case "a_preparer": return list.filter((r) => r.status === "demande_creee" || r.status === "a_preparer");
      case "prepares": return list.filter((r) => r.status === "prepare");
      case "urgences": return list.filter(isUrgent);
      case "avoirs_attendus": return list.filter((r) => r.status === "avoir_attendu" || r.status === "expedie");
      case "avoirs_partiels": return list.filter((r) => r.status === "partiellement_avoire");
      case "consignes": return list.filter((r) => r.lines.some((l) => l.item_type === "consigne"));
      case "litiges": return list.filter((r) => ["litige", "refus", "blocage_fournisseur"].includes(r.status));
      case "clotures": return list.filter((r) => r.status === "cloture");
      default: return list;
    }
  }, [list, filter]);

  return (
    <AppShell
      title="Magasin"
      subtitle="Retours pièces et avoirs"
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
        <span className="flex-1 text-left text-lg font-extrabold uppercase tracking-wide">Nouvelle demande de retour</span>
      </button>

      {drafts.length ? (
        <div className="mt-4">
          <h2 className="px-1 pb-2 text-sm font-extrabold uppercase tracking-wide text-amber-700">
            Brouillons à terminer ({drafts.length})
          </h2>
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.id}>
                <DraftCard row={d} supplierName={suppliers.data?.find((s) => s.id === d.supplier_id)?.name ?? null} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {FILTERS.map((f) => (
          <Counter
            key={f.key}
            label={f.label}
            value={counters[f.key as keyof typeof counters] as number}
            active={filter === f.key}
            onClick={() => setFilter(filter === f.key ? "" : f.key)}
          />
        ))}
        <Counter label="Montant attendu" value={`${counters.montant_attendu.toFixed(0)} €`} />
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
                      {suppliers.data?.find((s) => s.id === r.supplier_id)?.name ?? "Fournisseur ?"} · {r.lines.length} ligne(s)
                    </div>
                    {r.plate ? <div className="mt-1 plate-badge text-base">{formatPlate(r.plate)}</div> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={returnStatusTone(r.status)}>{returnStatusLabel(r.status)}</Badge>
                    {isUrgent(r) ? <Badge tone="bg-red-200 text-red-950">Délai</Badge> : null}
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
        <p className="text-sm text-muted-foreground">Aucun retour.</p>
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
        <div className="truncate text-xs text-muted-foreground">
          Modifié le {new Date(row.updated_at).toLocaleDateString("fr-FR")}
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
