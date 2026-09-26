import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge, btnGhost, btnPrimary, inputCls, numOrNull, ORDER_STATUS, OrLink, OrPicker, SiteFilter, SupplierSelect, usePartsCtx, WriteSiteSelect } from "@/components/parts/PartsUi";
import { allocateToOr, createOrder, findStockByRef, listOrders, type OrderLineInput, type OrLite, type StockRow } from "@/lib/parts";

export const Route = createFileRoute("/pieces-achats/commandes")({
  head: () => ({
    meta: [
      { title: "Commandes pièces — DDA Connect" },
      { name: "description", content: "Commandes fournisseurs simplifiées ou détaillées, rattachées aux OR WinMotor." },
      { property: "og:title", content: "Commandes pièces — DDA Connect" },
      { property: "og:description", content: "Commandes fournisseurs de l'atelier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersPage,
});

const emptyLine = (): OrderLineInput => ({ line_kind: "part", physical_reference: "", designation: "", qty_ordered: 1, expected_unit_cost_ht: null });

function OrdersPage() {
  const { siteName } = usePartsCtx();
  const [scope, setScope] = useState("groupe");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["part-orders", scope, status], queryFn: () => listOrders({ siteId: scope === "groupe" ? null : scope, status: status || undefined }) });

  return (
    <AppShell title="Commandes" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="space-y-3">
        {creating ? <NewOrder onDone={() => setCreating(false)} /> : (
          <button className={`${btnPrimary} w-full`} onClick={() => setCreating(true)}>
            <Plus className="mr-1 inline h-4 w-4" /> Nouvelle commande
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <SiteFilter value={scope} onChange={setScope} />
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous statuts</option>
            {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {q.data && !q.data.length ? <p className="card-surface p-4 text-sm text-muted-foreground">Aucune commande.</p> : null}
        {(q.data ?? []).map((o) => {
          const lines = (o.part_order_lines ?? []).filter((l) => l.line_kind === "part");
          const st = ORDER_STATUS[o.status] ?? ORDER_STATUS.ordered!;
          return (
            <Link key={o.id} to="/pieces-achats/commande/$orderId" params={{ orderId: o.id }} className="block rounded-xl border-2 border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold">{(o.suppliers as { name: string } | null)?.name ?? "Fournisseur ?"}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {siteName(o.site_id)} · {new Date(o.created_at).toLocaleDateString("fr-FR")}
                {(o.repair_orders as { or_number: string | null } | null)?.or_number ? ` · OR ${(o.repair_orders as { or_number: string }).or_number}` : ""}
                {o.plate ? ` · ${o.plate}` : ""}
                {o.appointment_date ? ` · RDV ${new Date(o.appointment_date).toLocaleDateString("fr-FR")}` : ""}
              </div>
              <div className="mt-1 text-xs">
                {lines.length ? `${lines.length} ligne(s) · ${lines.filter((l) => l.status === "received").length} reçue(s)` : <Badge tone="warn">Commande non détaillée — complétude inconnue</Badge>}
              </div>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}

function NewOrder({ onDone }: { onDone: () => void }) {
  const { actor, writeSite } = usePartsCtx();
  const qc = useQueryClient();
  const [site, setSite] = useState<string | null>(writeSite);
  const [mode, setMode] = useState<"simplified" | "detailed">("simplified");
  const [destination, setDestination] = useState<"or" | "store_sale" | "stock">("or");
  const [supplier, setSupplier] = useState("");
  const [orv, setOrv] = useState<{ or: OrLite | null; plate: string; vehicleId: string | null }>({ or: null, plate: "", vehicleId: null });
  const [comment, setComment] = useState("");
  const [rdv, setRdv] = useState("");
  const [supRef, setSupRef] = useState("");
  const [lines, setLines] = useState<OrderLineInput[]>([emptyLine()]);
  const [stockHits, setStockHits] = useState<Record<number, StockRow[]>>({});
  const [busy, setBusy] = useState(false);

  async function checkStock(i: number, ref: string) {
    if (!ref.trim() || !site) return;
    const hits = (await findStockByRef(site, ref)).filter((h) => h.available_qty > 0);
    setStockHits((s) => ({ ...s, [i]: hits }));
  }

  async function allocateHit(i: number, h: StockRow) {
    if (!orv.or) return toast.error("Rattachez d'abord un OR WinMotor.");
    const qty = lines[i]?.qty_ordered ?? 1;
    await allocateToOr({ articleId: h.id, siteId: h.site_id, orId: orv.or.id, qty, ref: h.physical_reference, designation: h.designation }, actor);
    toast.success(`${qty} × ${h.physical_reference} affecté(s) à l'OR ${orv.or.or_number}`);
    setLines((ls) => ls.filter((_, j) => j !== i));
    setStockHits({});
  }

  async function submit() {
    if (!site) return toast.error("Choisissez le site de la commande.");
    if (!supplier) return toast.error("Fournisseur obligatoire.");
    if (!orv.or && !orv.plate.trim() && destination === "or") return toast.error("Indiquez un OR ou une immatriculation.");
    setBusy(true);
    try {
      const id = await createOrder({
        site_id: site,
        supplier_id: supplier,
        order_mode: mode,
        destination,
        repair_order_id: orv.or?.id ?? null,
        vehicle_id: orv.vehicleId,
        plate: orv.plate.trim() || orv.or?.plate || null,
        appointment_date: rdv || null,
        supplier_order_ref: supRef.trim() || null,
        comment: comment.trim() || null,
        lines: mode === "detailed" ? lines : [],
      }, actor);
      toast.success("Commande enregistrée");
      qc.invalidateQueries({ queryKey: ["part-orders"] });
      onDone();
      void id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface space-y-3 p-4">
      <div className="grid grid-cols-2 gap-2">
        {(["simplified", "detailed"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`h-11 rounded-lg border-2 text-xs font-extrabold uppercase ${mode === m ? "border-brand bg-brand text-brand-foreground" : "border-border"}`}>
            {m === "simplified" ? "Simplifiée" : "Détaillée"}
          </button>
        ))}
      </div>
      <WriteSiteSelect value={site} onChange={setSite} />
      <SupplierSelect value={supplier} onChange={setSupplier} required />
      {mode === "detailed" ? (
        <select className={inputCls} value={destination} onChange={(e) => setDestination(e.target.value as typeof destination)}>
          <option value="or">Destination : OR</option>
          <option value="store_sale">Destination : vente magasin</option>
          <option value="stock">Destination : stock</option>
        </select>
      ) : null}
      <OrPicker value={orv} onChange={setOrv} />
      <input className={inputCls} type="date" value={rdv} onChange={(e) => setRdv(e.target.value)} aria-label="Date RDV" title="Date RDV (facultative)" />
      <textarea className={`${inputCls} h-20 py-2`} placeholder="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {mode === "detailed" ? (
        <>
          <input className={inputCls} placeholder="N° commande fournisseur (facultatif)" value={supRef} onChange={(e) => setSupRef(e.target.value)} />
          {lines.map((l, i) => (
            <div key={i} className="space-y-2 rounded-lg border-2 border-border p-2">
              <div className="flex gap-2">
                <select className={`${inputCls} w-28`} value={l.line_kind} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, line_kind: e.target.value as OrderLineInput["line_kind"] } : x)))}>
                  <option value="part">Pièce</option>
                  <option value="fee">Frais</option>
                  <option value="deposit">Consigne</option>
                </select>
                <input className={inputCls} placeholder="Référence" value={l.physical_reference} onBlur={(e) => l.line_kind === "part" && checkStock(i, e.target.value)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, physical_reference: e.target.value } : x)))} />
                <button type="button" aria-label="Supprimer la ligne" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
              <input className={inputCls} placeholder="Désignation" value={l.designation} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, designation: e.target.value } : x)))} />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputCls} inputMode="decimal" placeholder="Qté" value={l.qty_ordered ?? ""} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty_ordered: numOrNull(e.target.value) } : x)))} />
                <input className={inputCls} inputMode="decimal" placeholder="Prix HT attendu" value={l.expected_unit_cost_ht ?? ""} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, expected_unit_cost_ht: numOrNull(e.target.value) } : x)))} />
              </div>
              {stockHits[i]?.length ? (
                <div className="rounded-lg border-2 border-status-watch bg-status-watch-soft p-2 text-xs">
                  <p className="font-extrabold uppercase">Pièce déjà en stock</p>
                  {stockHits[i]!.map((h) => (
                    <div key={h.id} className="mt-1 flex flex-wrap items-center gap-2">
                      <span>{h.physical_reference} · dispo {h.available_qty}{h.location ? ` · ${h.location}` : ""}</span>
                      <Link to="/pieces-achats/stock" className="underline">Voir stock</Link>
                      <button type="button" className="underline" onClick={() => allocateHit(i, h)}>Affecter au dossier</button>
                      <button type="button" className="underline" onClick={() => setStockHits((s) => ({ ...s, [i]: [] }))}>Commander quand même</button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          <button type="button" className={btnGhost} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Ligne</button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Commande non détaillée : le contenu sera complété par le document fournisseur.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btnGhost} onClick={onDone}>Annuler</button>
        <button type="button" className={btnPrimary} onClick={submit} disabled={busy}>Enregistrer</button>
      </div>
    </div>
  );
}

export { OrLink };
