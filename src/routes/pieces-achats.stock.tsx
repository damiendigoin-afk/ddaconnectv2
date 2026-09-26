import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { ageDays, Badge, btnGhost, btnPrimary, fmtEur, inputCls, numOrNull, SiteFilter, usePartsCtx } from "@/components/parts/PartsUi";
import { adjustStock, listMovements, listStock, supplierReturnOut, updateArticle, type StockRow } from "@/lib/parts";
import { MOVEMENT_LABELS, type MovementType } from "@/lib/parts-rules";

export const Route = createFileRoute("/pieces-achats/stock")({
  head: () => ({
    meta: [
      { title: "Stock pièces — DDA Connect" },
      { name: "description", content: "Stock par site : disponible, affecté OR, emplacement, PAMP et dernier prix d'achat." },
      { property: "og:title", content: "Stock pièces — DDA Connect" },
      { property: "og:description", content: "Stock pièces par site et groupe." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StockPage,
});

function StockPage() {
  const { siteName } = usePartsCtx();
  const [scope, setScope] = useState("groupe");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["stock", scope, q], queryFn: () => listStock({ siteId: scope === "groupe" ? null : scope, q }) });
  return (
    <AppShell title="Stock / inventaire" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="space-y-3">
        <input className={inputCls} placeholder="Référence ou désignation" value={q} onChange={(e) => setQ(e.target.value)} />
        <SiteFilter value={scope} onChange={setScope} />
        {list.data && !list.data.length ? <p className="card-surface p-4 text-sm text-muted-foreground">Aucune référence en stock pour l'instant. Le stock se constitue à la réception des pièces.</p> : null}
        {(list.data ?? []).map((r) => (
          <div key={r.id} className="rounded-xl border-2 border-border bg-card p-3 text-sm">
            <button className="w-full text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <div className="flex justify-between gap-2">
                <b>{r.physical_reference}</b>
                <span className="text-xs text-muted-foreground">{siteName(r.site_id)}</span>
              </div>
              <div className="text-xs text-muted-foreground">{r.designation ?? "—"}{r.location ? ` · ${r.location}` : ""}</div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                <Badge tone={r.available_qty < 0 ? "bad" : "ok"}>Dispo {r.available_qty}{r.unit === "l" ? " L" : ""}</Badge>
                {r.allocated_qty ? <Badge tone="brand">Affecté OR {r.allocated_qty}</Badge> : null}
                {r.quarantine_qty ? <Badge tone="warn">À traiter {r.quarantine_qty}</Badge> : null}
                <span>Total {r.available_qty + r.allocated_qty + r.quarantine_qty}</span>
                <span>PAMP {fmtEur(r.pamp)}</span>
                <span>Dernier PA {fmtEur(r.last_purchase_price)}</span>
                {r.first_receipt_at ? <span>{ageDays(r.first_receipt_at)} j</span> : null}
              </div>
            </button>
            {open === r.id ? <ArticlePanel row={r} /> : null}
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function ArticlePanel({ row }: { row: StockRow }) {
  const { actor } = usePartsCtx();
  const qc = useQueryClient();
  const moves = useQuery({ queryKey: ["moves", row.id], queryFn: () => listMovements(row.id) });
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [loc, setLoc] = useState(row.location ?? "");
  const [pamp, setPamp] = useState(row.pamp?.toString() ?? "");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["stock"] }); qc.invalidateQueries({ queryKey: ["moves", row.id] }); };

  async function adjust() {
    const d = numOrNull(delta);
    if (!d) return void toast.error("Quantité +/- requise");
    if (!reason.trim()) return void toast.error("Motif obligatoire");
    await adjustStock(row.id, row.site_id, d, reason, actor);
    setDelta(""); setReason(""); refresh(); toast.success("Stock corrigé");
  }
  async function ret(fromQ: boolean) {
    const n = numOrNull(window.prompt("Quantité physiquement retournée au fournisseur :") ?? "");
    if (!n) return;
    await supplierReturnOut(row.id, row.site_id, n, fromQ, "Retour fournisseur physique", actor);
    refresh(); toast.success("Retour fournisseur enregistré");
  }
  async function save() {
    await updateArticle(row.id, { location: loc || null, pamp: numOrNull(pamp), ...(numOrNull(pamp) !== row.pamp ? { opening_value_source: "estimated" as const } : {}) }, row.site_id, actor);
    refresh(); toast.success("Fiche mise à jour");
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-xs font-bold uppercase text-muted-foreground">Ajuster / compter (site de cette référence)</p>
      <div className="grid grid-cols-3 gap-2">
        <input className={inputCls} inputMode="decimal" placeholder="+/−" value={delta} onChange={(e) => setDelta(e.target.value)} />
        <input className={`${inputCls} col-span-2`} placeholder="Motif obligatoire" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <button className={`${btnPrimary} w-full`} onClick={adjust}>Enregistrer la correction</button>
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="Emplacement / casier" value={loc} onChange={(e) => setLoc(e.target.value)} />
        <input className={inputCls} inputMode="decimal" placeholder="PAMP (valeur d'ouverture)" value={pamp} onChange={(e) => setPamp(e.target.value)} />
      </div>
      <button className={`${btnGhost} w-full`} onClick={save}>Enregistrer emplacement / valeur</button>
      <div className="grid grid-cols-2 gap-2">
        <button className={btnGhost} onClick={() => ret(false)}>Retour fourn. (dispo)</button>
        <button className={btnGhost} onClick={() => ret(true)} disabled={!row.quarantine_qty}>Retour fourn. (à traiter)</button>
      </div>
      <p className="text-xs font-bold uppercase text-muted-foreground">Historique</p>
      {(moves.data ?? []).map((m) => (
        <div key={m.id} className="text-xs">
          {new Date(m.created_at).toLocaleString("fr-FR")} · {MOVEMENT_LABELS[m.movement_type as MovementType]} · {m.qty} · {m.created_by_name}{m.reason ? ` — ${m.reason}` : ""}
        </div>
      ))}
    </div>
  );
}
