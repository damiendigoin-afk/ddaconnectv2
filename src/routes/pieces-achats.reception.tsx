import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge, btnGhost, btnPrimary, inputCls, numOrNull, OrPicker, SiteFilter, SupplierSelect, usePartsCtx, WriteSiteSelect } from "@/components/parts/PartsUi";
import { cancelReceiptIncident, getOrder, listOrders, listReceipts, listSupplierDocs, validateReceipt, type OrLite, type ReceiptLineInput } from "@/lib/parts";
import { isOverReceipt } from "@/lib/parts-rules";

export const Route = createFileRoute("/pieces-achats/reception")({
  validateSearch: (s: Record<string, unknown>): { order?: string } => (typeof s.order === "string" ? { order: s.order } : {}),
  head: () => ({
    meta: [
      { title: "Réception pièces — DDA Connect" },
      { name: "description", content: "Réception physique des pièces : depuis une commande, sans document ou avec BL/facture." },
      { property: "og:title", content: "Réception pièces — DDA Connect" },
      { property: "og:description", content: "Réception physique des pièces fournisseurs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceptionPage,
});

const blank = (): ReceiptLineInput => ({ order_line_id: null, physical_reference: "", designation: "", qty_expected: null, qty_received: 1, condition: "usable", destination: "or", allocate_qty: 1, unit_cost: null, expected_cost: null, ordered_reference: null, comment: "" });

function ReceptionPage() {
  const search = Route.useSearch();
  const [mode, setMode] = useState<null | "order" | "physical" | "document">(search.order ? "order" : null);
  return (
    <AppShell title="Réception pièces" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      {mode ? <ReceiptForm mode={mode} initialOrder={search.order ?? null} onDone={() => setMode(null)} /> : (
        <div className="space-y-3">
          <button className={`${btnPrimary} w-full`} onClick={() => setMode("order")}>Réceptionner une commande</button>
          <button className={`${btnGhost} w-full`} onClick={() => setMode("physical")}>Réception physique sans document</button>
          <button className={`${btnGhost} w-full`} onClick={() => setMode("document")}>Avec un BL / facture déjà déposé</button>
          <p className="text-xs text-muted-foreground">Seule la validation d'une réception physique fait bouger le stock. Un BL reçu par e-mail sans livraison ne change rien au stock.</p>
          <RecentReceipts />
        </div>
      )}
    </AppShell>
  );
}

function RecentReceipts() {
  const { siteName, actor } = usePartsCtx();
  const [scope, setScope] = useState("groupe");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["part-receipts", scope], queryFn: () => listReceipts(scope === "groupe" ? null : scope) });
  return (
    <section className="space-y-2 pt-2">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Réceptions récentes</h2>
      <SiteFilter value={scope} onChange={setScope} />
      {(q.data ?? []).map((r) => (
        <div key={r.id} className="rounded-xl border-2 border-border bg-card p-3 text-sm">
          <div className="flex justify-between gap-2">
            <b>{(r.suppliers as { name: string } | null)?.name ?? "Fournisseur ?"}</b>
            {r.status === "incident" ? <Badge tone="bad">Incident</Badge> : r.receipt_type === "physical_without_document" ? <Badge tone="warn">En attente de document</Badge> : <Badge tone="ok">Validée</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            {siteName(r.site_id)} · {new Date(r.received_at).toLocaleString("fr-FR")} · {r.received_by_name}
            {(r.repair_orders as { or_number: string | null } | null)?.or_number ? ` · OR ${(r.repair_orders as { or_number: string }).or_number}` : ""}
            {r.plate ? ` · ${r.plate}` : ""}
          </div>
          <div className="text-xs">{(r.part_receipt_lines ?? []).map((l) => `${l.qty_received}× ${l.physical_reference ?? l.designation ?? "?"}`).join(", ") || r.comment}</div>
          {r.order_id ? <Link to="/pieces-achats/commande/$orderId" params={{ orderId: r.order_id }} className="text-xs underline">Voir la commande</Link> : null}
          {r.status !== "incident" ? (
            <button className="ml-3 text-xs underline" onClick={async () => { const why = window.prompt("Incident (ex. livré au mauvais site) — motif :"); if (!why) return; await cancelReceiptIncident(r.id, r.site_id, why, actor); qc.invalidateQueries({ queryKey: ["part-receipts"] }); toast.success("Incident enregistré — pensez à corriger le stock si nécessaire."); }}>Signaler incident</button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function ReceiptForm({ mode, initialOrder, onDone }: { mode: "order" | "physical" | "document"; initialOrder: string | null; onDone: () => void }) {
  const { actor, writeSite, siteName } = usePartsCtx();
  const qc = useQueryClient();
  const [site, setSite] = useState<string | null>(writeSite);
  const [orderId, setOrderId] = useState<string | null>(initialOrder);
  const [supplier, setSupplier] = useState("");
  const [orv, setOrv] = useState<{ or: OrLite | null; plate: string; vehicleId: string | null }>({ or: null, plate: "", vehicleId: null });
  const [docId, setDocId] = useState("");
  const [packages, setPackages] = useState("");
  const [comment, setComment] = useState("");
  const [lines, setLines] = useState<ReceiptLineInput[]>(mode === "order" ? [] : [blank()]);
  const [busy, setBusy] = useState(false);

  const openOrders = useQuery({ queryKey: ["open-orders", site], enabled: mode === "order", queryFn: async () => (await listOrders({ siteId: site })).filter((o) => o.status === "ordered" || o.status === "partial") });
  const docs = useQuery({ queryKey: ["supplier-docs", site], enabled: mode === "document", queryFn: () => listSupplierDocs(site) });

  useEffect(() => {
    if (!orderId) return;
    void getOrder(orderId).then((o) => {
      if (site && o.site_id !== site) toast.warning(`Commande du site ${siteName(o.site_id)} : la réception sera faite sur ce site.`);
      setSite(o.site_id);
      setSupplier(o.supplier_id ?? "");
      setOrv({ or: o.repair_order_id ? { id: o.repair_order_id, or_number: (o.repair_orders as { or_number: string | null } | null)?.or_number ?? null, site_id: o.site_id, vehicle_id: o.vehicle_id, plate: o.plate } : null, plate: o.plate ?? "", vehicleId: o.vehicle_id });
      const dest = o.destination === "or" ? (o.repair_order_id ? "or" : "unknown") : o.destination;
      const parts = (o.part_order_lines ?? []).filter((l) => l.line_kind === "part" && l.status !== "received");
      setLines(parts.length ? parts.map((l) => {
        const rest = l.qty_ordered != null ? Math.max(0, l.qty_ordered - l.qty_received) : 1;
        return { ...blank(), order_line_id: l.id, physical_reference: l.physical_reference ?? "", ordered_reference: l.physical_reference, designation: l.designation ?? "", qty_expected: rest, qty_received: rest, allocate_qty: rest, expected_cost: l.expected_unit_cost_ht, destination: dest as ReceiptLineInput["destination"] };
      }) : [{ ...blank(), destination: dest as ReceiptLineInput["destination"] }]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const set = (i: number, p: Partial<ReceiptLineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function submit() {
    if (!site) return toast.error("Choisissez le site qui reçoit physiquement.");
    if (!supplier && mode !== "order") return toast.error("Fournisseur obligatoire.");
    const over = lines.filter((l) => isOverReceipt(l.qty_expected, l.qty_received));
    if (over.length && !window.confirm(`Sur-réception : ${over.map((l) => `${l.physical_reference} attendu ${l.qty_expected} / reçu ${l.qty_received}`).join(", ")}. Confirmer les quantités réellement reçues ?`)) return;
    setBusy(true);
    try {
      await validateReceipt({
        site_id: site,
        supplier_id: supplier || null,
        order_id: orderId,
        repair_order_id: orv.or?.id ?? null,
        vehicle_id: orv.vehicleId,
        plate: orv.plate.trim() || null,
        source_document_id: docId || null,
        receipt_type: docId ? "document" : "physical_without_document",
        packages: packages.trim() || null,
        comment: comment.trim() || null,
        lines: lines.map((l) => ({ ...l, destination: l.destination === "or" && !orv.or ? "unknown" : l.destination })),
      }, actor);
      toast.success("Réception validée — stock mis à jour");
      qc.invalidateQueries();
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface space-y-3 p-4">
      <WriteSiteSelect value={site} onChange={setSite} />
      {mode === "order" && !orderId ? (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">Commandes en attente</p>
          {(openOrders.data ?? []).map((o) => (
            <button key={o.id} className="block w-full rounded-lg border-2 border-border p-2 text-left text-sm" onClick={() => setOrderId(o.id)}>
              <b>{(o.suppliers as { name: string } | null)?.name}</b> · {(o.repair_orders as { or_number: string | null } | null)?.or_number ? `OR ${(o.repair_orders as { or_number: string }).or_number}` : o.plate ?? "sans OR"} · {new Date(o.created_at).toLocaleDateString("fr-FR")}
            </button>
          ))}
          {openOrders.data && !openOrders.data.length ? <p className="text-sm text-muted-foreground">Aucune commande en attente sur ce site.</p> : null}
        </div>
      ) : null}
      {mode !== "order" || orderId ? (
        <>
          {mode !== "order" ? <SupplierSelect value={supplier} onChange={setSupplier} required /> : null}
          {mode === "document" ? (
            <select className={inputCls} value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">— BL / facture déposé —</option>
              {(docs.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.file_name} · {new Date(d.created_at).toLocaleDateString("fr-FR")}</option>)}
            </select>
          ) : null}
          <OrPicker value={orv} onChange={setOrv} />
          <input className={inputCls} placeholder="Colis / cartons (facultatif)" value={packages} onChange={(e) => setPackages(e.target.value)} />
          <textarea className={`${inputCls} h-16 py-2`} placeholder="Commentaire" value={comment} onChange={(e) => setComment(e.target.value)} />
          {lines.map((l, i) => (
            <div key={i} className="space-y-2 rounded-lg border-2 border-border p-2">
              <input className={inputCls} placeholder="Référence réellement reçue" value={l.physical_reference} onChange={(e) => set(i, { physical_reference: e.target.value })} />
              {l.ordered_reference && l.physical_reference && l.ordered_reference.replace(/\W/g, "").toUpperCase() !== l.physical_reference.replace(/\W/g, "").toUpperCase() ? <Badge tone="warn">Différente de la référence commandée ({l.ordered_reference})</Badge> : null}
              <input className={inputCls} placeholder="Désignation" value={l.designation} onChange={(e) => set(i, { designation: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Qté reçue{l.qty_expected != null ? ` (attendu ${l.qty_expected})` : ""}
                  <input className={inputCls} inputMode="decimal" value={l.qty_received} onChange={(e) => { const q = numOrNull(e.target.value) ?? 0; set(i, { qty_received: q, allocate_qty: q }); }} />
                </label>
                <label className="text-xs">Prix HT (facultatif)
                  <input className={inputCls} inputMode="decimal" value={l.unit_cost ?? ""} onChange={(e) => set(i, { unit_cost: numOrNull(e.target.value) })} />
                </label>
              </div>
              {l.unit_cost != null && l.expected_cost != null && Math.abs(l.unit_cost - l.expected_cost) > 0.009 ? <Badge tone="warn">Écart de prix signalé (attendu {l.expected_cost})</Badge> : null}
              <div className="grid grid-cols-2 gap-2">
                <select className={inputCls} value={l.condition} onChange={(e) => set(i, { condition: e.target.value as ReceiptLineInput["condition"] })}>
                  <option value="usable">Utilisable</option>
                  <option value="damaged_return">Endommagée — à retourner</option>
                  <option value="to_check">À vérifier</option>
                </select>
                <select className={inputCls} value={l.destination} onChange={(e) => set(i, { destination: e.target.value as ReceiptLineInput["destination"] })}>
                  <option value="or">Pour l'OR</option>
                  <option value="stock">Stock</option>
                  <option value="store_sale">Vente magasin</option>
                  <option value="unknown">Destination inconnue</option>
                </select>
              </div>
              {l.destination === "or" && l.condition === "usable" ? (
                orv.or ? (
                  <label className="text-xs">Qté à affecter à l'OR {orv.or.or_number}
                    <input className={inputCls} inputMode="decimal" value={l.allocate_qty} onChange={(e) => set(i, { allocate_qty: numOrNull(e.target.value) ?? 0 })} />
                  </label>
                ) : <p className="text-xs text-muted-foreground">Aucun OR WinMotor rattaché : la pièce entre en stock, destination à régulariser.</p>
              ) : null}
              <input className={inputCls} placeholder="Commentaire ligne" value={l.comment} onChange={(e) => set(i, { comment: e.target.value })} />
            </div>
          ))}
          <button type="button" className={btnGhost} onClick={() => setLines((ls) => [...ls, blank()])}>+ Pièce reçue</button>
          <div className="grid grid-cols-2 gap-2">
            <button className={btnGhost} onClick={onDone}>Annuler</button>
            <button className={btnPrimary} onClick={submit} disabled={busy}>Valider réception</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
