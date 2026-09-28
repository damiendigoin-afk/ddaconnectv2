import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { DocDropZone } from "@/components/parts/DocDropZone";
import { orderMarker } from "@/lib/receipt-lines";
import { ActiveSiteNote, Badge, btnGhost, btnPrimary, inputCls, numOrNull, OrPicker, SiteMismatchAlert, SupplierSelect, usePartsCtx, useSuppliers } from "@/components/parts/PartsUi";
import { cancelReceiptIncident, findOrByNumber, getOrder, listOrders, listReceipts, listSupplierDocs, openRegularization, validateReceipt, type OrLite, type ReceiptLineInput } from "@/lib/parts";
import { guessDocumentSite, matchOrders, matchSupplier, pendingReceptionOrders } from "@/lib/parts-site";
import { docSiteText, readPurchaseDoc } from "@/lib/purchase-doc";
import { getSupplierDoc, updateSupplierDoc, uploadSupplierDoc, type SupplierDoc } from "@/lib/supplier-docs";
import { ensureSupplierByName } from "@/lib/suppliers";
import { docSupplierId } from "@/lib/supplier-identify";
import { DocSupplierLink } from "@/components/parts/DocSupplierLink";
import { isOverReceipt } from "@/lib/parts-rules";
import { blankReceiptLine, lineAnomalies, receiptLinesFromDoc } from "@/lib/receipt-lines";
import { requestedDossier } from "@/lib/parts-site";
import { Check } from "lucide-react";
import { OrderLinesCompact } from "@/components/parts/OrderLinesCompact";
import { receiptLinesFromOrder } from "@/lib/receipt-lines";

export const Route = createFileRoute("/pieces-achats/reception")({
  validateSearch: (s: Record<string, unknown>): { order?: string; doc?: string } => ({
    ...(typeof s["order"] === "string" ? { order: s["order"] } : {}),
    ...(typeof s["doc"] === "string" ? { doc: s["doc"] } : {}),
  }),
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

const blank = blankReceiptLine;

type Mode = null | "order" | "physical" | "document";

function ReceptionPage() {
  const search = Route.useSearch();
  const [mode, setMode] = useState<Mode>(search.order ? "order" : null);
  const [orderId, setOrderId] = useState<string | null>(search.order ?? null);
  const [doc, setDoc] = useState<SupplierDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const { actor, writeSite } = usePartsCtx();

  useEffect(() => {
    if (!search.doc) return;
    void getSupplierDoc(search.doc).then((d) => d && setDoc(d));
  }, [search.doc]);

  async function onFile(file: File) {
    if (!writeSite) return void toast.error("Choisissez le site actif dans la barre du haut.");
    setBusy(true);
    try {
      const r = await readPurchaseDoc(file);
      if (r.warning) toast.warning(r.warning);
      // Le BL rejoint la file documents existante : aucun redépôt ultérieur nécessaire.
      const created = await uploadSupplierDoc({ file: r.file, extracted: { ...r.extracted, doc_kind: r.extracted.doc_kind ?? "bl" }, siteId: writeSite, userId: actor.userId, userName: actor.name });
      setDoc(created);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dépôt impossible");
    } finally {
      setBusy(false);
    }
  }

  const reset = () => { setMode(null); setOrderId(null); setDoc(null); };

  return (
    <AppShell title="Réceptionner des pièces" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="space-y-3">
        <ActiveSiteNote />
        {mode ? (
          <ReceiptForm mode={mode} initialOrder={orderId} doc={doc} onDone={reset} />
        ) : doc ? (
          <DocMatch doc={doc} onOrder={(id) => { setOrderId(id); setMode("order"); }} onNoOrder={() => setMode("document")} onCancel={reset} />
        ) : (
          <>
            <DocDropZone title="Scanner / déposer un BL" hint="Glissez-déposez le bon de livraison (PDF, photo, capture) : rapprochement automatique" busy={busy} onFile={onFile} />
            <PendingOrderList onPick={(id) => { setOrderId(id); setMode("order"); }} />
            <button className={`${btnGhost} w-full`} onClick={() => setMode("physical")}>Réception physique sans document</button>
            <p className="text-xs text-muted-foreground">Seule la validation d'une réception physique fait bouger le stock. Un BL reçu par e-mail sans livraison ne change rien au stock.</p>
            <RecentReceipts />
          </>
        )}
      </div>
    </AppShell>
  );
}

function PendingOrderList({ onPick }: { onPick: (id: string) => void }) {
  const { readSite, siteName } = usePartsCtx();
  const q = useQuery({ queryKey: ["open-orders", readSite], queryFn: async () => pendingReceptionOrders(await listOrders({ siteId: readSite })) });
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Commandes en attente de réception</h2>
      {q.data && !q.data.length ? <p className="card-surface p-3 text-sm text-muted-foreground">Aucune commande en attente sur ce site.</p> : null}
      {(q.data ?? []).map((o) => (
        <button key={o.id} className="block w-full rounded-xl border-2 border-border bg-card p-3 text-left text-sm" onClick={() => onPick(o.id)}>
          <div className="flex justify-between gap-2"><b>{(o.suppliers as { name: string } | null)?.name ?? "Fournisseur à préciser"}</b>{o.status === "partial" ? <Badge tone="warn">Reliquat</Badge> : null}</div>
          <div className="text-xs text-muted-foreground">
            {siteName(o.site_id)} · {orderMarker(o as never)} · {new Date(o.created_at).toLocaleDateString("fr-FR")}
          </div>
          <OrderLinesCompact lines={o.part_order_lines ?? []} />
        </button>
      ))}
    </section>
  );
}

/** Rapprochement BL ↔ commandes en attente du site actif. Jamais bloquant. */
export function DocMatch({ doc, onOrder, onNoOrder, onCancel }: { doc: SupplierDoc; onOrder: (id: string) => void; onNoOrder: () => void; onCancel: () => void }) {
  const { writeSite, sites } = usePartsCtx();
  const suppliers = useSuppliers();
  const x = doc.extracted;
  const orders = useQuery({ queryKey: ["open-orders-match", writeSite], queryFn: () => listOrders({ siteId: writeSite }) });
  const matches = matchOrders(x, orders.data ?? [], writeSite);
  const sup = matchSupplier(x.supplier, suppliers.data ?? []);
  return (
    <div className="card-surface space-y-3 p-4">
      <p className="text-xs font-extrabold uppercase text-muted-foreground">Document : {doc.file_name}</p>
      <SiteMismatchAlert docSite={guessDocumentSite(docSiteText(x), sites)} />
      <div className="text-xs">
        {x.supplier ? <DocSupplierLink extracted={x} docId={doc.id} /> : <p>Fournisseur : <b>{sup?.name ?? "non lu"}</b></p>}
        <p>OR / dossier : <b>{x.or_number ?? "—"}</b> · Immat : <b>{x.plate ?? "—"}</b> · Réf. commande : <b>{x.order_reference ?? "—"}</b></p>
        <p>{(x.lines ?? []).length} ligne(s) lue(s)</p>
      </div>
      {orders.isLoading ? <p className="text-sm text-muted-foreground">Recherche des commandes…</p> : null}
      {matches.map((m) => (
        <button key={m.order.id} className="block w-full rounded-lg border-2 border-brand p-3 text-left text-sm" onClick={() => onOrder(m.order.id)}>
          <Badge tone={m.level === "certain" ? "ok" : "warn"}>{m.level === "certain" ? "Correspondance certaine" : "Correspondance probable"}</Badge>{" "}
          <b>{(m.order.suppliers as { name: string } | null)?.name ?? "Fournisseur ?"}</b>
          {` · ${orderMarker(m.order as never)}`} — Contrôler la réception
        </button>
      ))}
      {orders.data && !matches.length ? <p className="text-sm text-muted-foreground">Aucune commande DDA correspondante sur ce site.</p> : null}
      <button className={`${btnGhost} w-full`} onClick={onNoOrder}>Réceptionner sans commande (depuis le BL)</button>
      <button className="w-full text-xs underline" onClick={onCancel}>Annuler</button>
    </div>
  );
}

function RecentReceipts() {
  const { siteName, actor, readSite } = usePartsCtx();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["part-receipts", readSite], queryFn: () => listReceipts(readSite) });
  return (
    <section className="space-y-2 pt-2">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Réceptions récentes</h2>
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

function ReceiptForm({ mode, initialOrder, doc, onDone }: { mode: "order" | "physical" | "document"; initialOrder: string | null; doc: SupplierDoc | null; onDone: () => void }) {
  const { actor, writeSite, siteName } = usePartsCtx();
  const suppliers = useSuppliers();
  const qc = useQueryClient();
  const x = doc?.extracted ?? {};
  const [site, setSite] = useState<string | null>(writeSite);
  const [orderId, setOrderId] = useState<string | null>(initialOrder);
  const [supplier, setSupplier] = useState("");
  const [orv, setOrv] = useState<{ or: OrLite | null; plate: string; vehicleId: string | null }>({ or: null, plate: x.plate ?? "", vehicleId: null });
  const [docId, setDocId] = useState(doc?.id ?? "");
  const [packages, setPackages] = useState("");
  const [comment, setComment] = useState("");
  const [dossier, setDossier] = useState(x.or_number ?? "");
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [lines, setLines] = useState<ReceiptLineInput[]>(() => {
    if (mode === "order") return [];
    const fromDoc = receiptLinesFromDoc(x.lines);
    return fromDoc.length ? fromDoc : [blank()];
  });

  // Pré-remplissage depuis le BL : fournisseur connu et OR existant (jamais de création d'OR).
  useEffect(() => {
    if (!doc || mode === "order") return;
    if (x.or_number) void findOrByNumber(x.or_number).then((o) => { if (o) setOrv({ or: o, plate: o.plate ?? x.plate ?? "", vehicleId: o.vehicle_id }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);
  useEffect(() => {
    if (!doc || supplier || mode === "order") return;
    const id = docSupplierId(x, suppliers.data ?? []);
    if (id) setSupplier(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers.data, doc?.id]);
  const [busy, setBusy] = useState(false);

  const openOrders = useQuery({ queryKey: ["open-orders", site], enabled: mode === "order", queryFn: async () => (await listOrders({ siteId: site })).filter((o) => o.status === "ordered" || o.status === "partial") });
  const docs = useQuery({ queryKey: ["supplier-docs", site], enabled: mode === "document", queryFn: () => listSupplierDocs(site) });

  useEffect(() => {
    if (!orderId) return;
    void getOrder(orderId).then((o) => {
      if (site && o.site_id !== site) toast.warning(`Commande du site ${siteName(o.site_id)} : la réception sera faite sur ce site.`);
      setSite(o.site_id);
      setSupplier(o.supplier_id ?? "");
      setDossier(o.requested_or_number ?? "");
      setOrv({ or: o.repair_order_id ? { id: o.repair_order_id, or_number: (o.repair_orders as { or_number: string | null } | null)?.or_number ?? null, site_id: o.site_id, vehicle_id: o.vehicle_id, plate: o.plate } : null, plate: o.plate ?? "", vehicleId: o.vehicle_id });
      const dest = o.destination === "or" ? (o.repair_order_id ? "or" : "unknown") : o.destination;
       const parts = receiptLinesFromOrder(o.part_order_lines ?? [], dest as ReceiptLineInput["destination"]);
       setLines(parts.length ? parts : [{ ...blank(), destination: dest as ReceiptLineInput["destination"] }]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const set = (i: number, p: Partial<ReceiptLineInput>) => { setChecked((c) => ({ ...c, [i]: false })); setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l))); };
  const reqOr = requestedDossier(orv.or, dossier);

  async function submit() {
    if (!site) return void toast.error("Choisissez le site actif dans la barre du haut.");
    const over = lines.filter((l) => isOverReceipt(l.qty_expected, l.qty_received));
    if (over.length && !window.confirm(`Sur-réception : ${over.map((l) => `${l.physical_reference} attendu ${l.qty_expected} / reçu ${l.qty_received}`).join(", ")}. Confirmer les quantités réellement reçues ?`)) return;
    setBusy(true);
    try {
      // Fournisseur détecté sur le BL mais non sélectionné : rattachement/création à la validation.
      let supplierId = supplier || null;
      if (!supplierId && x.supplier) {
        supplierId = await ensureSupplierByName(x.supplier);
        if (supplierId) { setSupplier(supplierId); void qc.invalidateQueries({ queryKey: ["suppliers-list"] }); }
      }
      const receiptId = await validateReceipt({
        site_id: site,
        supplier_id: supplierId,
        order_id: orderId,
        repair_order_id: orv.or?.id ?? null,
        vehicle_id: orv.vehicleId,
        plate: orv.plate.trim() || null,
        source_document_id: docId || null,
        receipt_type: docId ? "document" : "physical_without_document",
        packages: packages.trim() || null,
        comment: comment.trim() || null,
        requested_or_number: reqOr,
        lines: lines.map((l) => ({ ...l, destination: l.destination === "or" && !orv.or ? "unknown" : l.destination })),
      }, actor);
      // Rien ne bloque : ce qui manque part dans « À régulariser ».
      if (!orderId && docId) await openRegularization({ site_id: site, kind: "reception_sans_commande", source_table: "part_receipts", source_id: receiptId, repair_order_id: orv.or?.id ?? null, supplier_id: supplier || null, plate: orv.plate.trim() || null, comment: "Réception faite depuis un BL sans commande DDA" }, actor);
      if (!supplier && !orderId) await openRegularization({ site_id: site, kind: "commande_sans_fournisseur", source_table: "part_receipts", source_id: receiptId, plate: orv.plate.trim() || null, comment: "Réception sans fournisseur identifié" }, actor);
      if (docId) await updateSupplierDoc(docId, { status: "a_verifier" }).catch(() => undefined);
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
      <p className="text-xs font-extrabold uppercase text-muted-foreground">Réception sur {site ? siteName(site) : "?"}{doc ? ` · BL ${doc.file_name}` : ""}</p>
      {mode === "order" && !orderId ? (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">Commandes en attente</p>
          {(openOrders.data ?? []).map((o) => (
            <button key={o.id} className="block w-full rounded-lg border-2 border-border p-2 text-left text-sm" onClick={() => setOrderId(o.id)}>
              <b>{(o.suppliers as { name: string } | null)?.name}</b> · {orderMarker(o as never)} · {new Date(o.created_at).toLocaleDateString("fr-FR")}
               <OrderLinesCompact lines={o.part_order_lines ?? []} />
            </button>
          ))}
          {openOrders.data && !openOrders.data.length ? <p className="text-sm text-muted-foreground">Aucune commande en attente sur ce site.</p> : null}
        </div>
      ) : null}
      {mode !== "order" || orderId ? (
        <>
          {doc && mode !== "order" && !supplier && x.supplier ? <DocSupplierLink extracted={x} docId={doc.id} onLinked={setSupplier} /> : null}
          {mode !== "order" ? <SupplierSelect value={supplier} onChange={setSupplier} /> : null}
          {mode === "document" && !doc ? (
            <select className={inputCls} value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">— BL / facture déposé —</option>
              {(docs.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.file_name} · {new Date(d.created_at).toLocaleDateString("fr-FR")}</option>)}
            </select>
          ) : null}
          {doc ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg border-2 border-border bg-muted p-2 text-xs md:grid-cols-5">
              <p>Fournisseur<br /><b>{(suppliers.data ?? []).find((s) => s.id === (supplier || docSupplierId(x, suppliers.data ?? [])))?.name ?? x.supplier ?? "—"}</b></p>
              <p>BL n°<br /><b>{x.delivery_note_number ?? x.document_number ?? "—"}</b></p>
              <p>N° commande fournisseur<br /><b>{x.order_reference && x.order_reference !== x.or_number ? x.order_reference : "—"}</b></p>
              <p>N° dossier / OR WinMotor<br /><b>{orv.or?.or_number ?? (dossier || x.or_number) ?? "—"}</b></p>
              <p>Immatriculation<br /><b>{orv.plate || x.plate || "—"}</b></p>
            </div>
          ) : null}
          <OrPicker value={orv} onChange={setOrv} initialNumber={dossier || x.or_number || null} onNumberChange={setDossier} />
          {!orv.or ? (
            <p className="rounded-lg border-2 border-border bg-muted p-2 text-xs font-bold">
              {reqOr ? `Dossier ${reqOr} — aucun OR DDA rattaché : conservé pour le rapprochement à la facture WinMotor. ` : "Aucun OR DDA rattaché. "}Les pièces « Pour l'OR » entrent en stock, destination à régulariser.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Colis / cartons (facultatif)" value={packages} onChange={(e) => setPackages(e.target.value)} />
            <input className={inputCls} placeholder="Commentaire" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
           <div className="hidden grid-cols-[1.05fr_1.65fr_0.5fr_0.5fr_0.55fr_0.65fr_0.8fr_0.9fr_auto] gap-1 px-1 text-[10px] font-extrabold uppercase text-muted-foreground md:grid">
             <span>Référence</span><span>Désignation</span><span>Commandée</span><span>Déjà reçue</span><span>Reçue maintenant</span><span>PA HT</span><span>État</span><span>Destination</span><span>Ctrl</span>
          </div>
          {lines.map((l, i) => {
            const anomalies = lineAnomalies(l);
            const ok = !!checked[i];
            const cell = "h-9 w-full rounded-md border-2 border-border bg-card px-2 text-xs";
            return (
              <div key={i} className={`rounded-lg border-2 p-2 md:p-1 ${ok ? "border-status-ok" : "border-border"}`}>
                 <div className="grid grid-cols-2 gap-1 md:grid-cols-[1.05fr_1.65fr_0.5fr_0.5fr_0.55fr_0.65fr_0.8fr_0.9fr_auto] md:items-center">
                  <input className={cell} aria-label="Référence" placeholder="Référence" value={l.physical_reference} onChange={(e) => set(i, { physical_reference: e.target.value })} />
                  <input className={`${cell} col-span-2 md:col-span-1 order-first md:order-none`} aria-label="Désignation" placeholder="Désignation" value={l.designation} onChange={(e) => set(i, { designation: e.target.value })} />
                   <span className="flex h-9 items-center text-xs"><span className="text-muted-foreground md:hidden">Commandée :&nbsp;</span>{l.qty_ordered ?? l.qty_expected ?? "—"}</span>
                   <span className="flex h-9 items-center text-xs"><span className="text-muted-foreground md:hidden">Déjà reçue :&nbsp;</span>{l.qty_already_received ?? 0}</span>
                   <input className={cell} aria-label="Qté reçue maintenant" inputMode="decimal" value={l.qty_received} onChange={(e) => { const q = numOrNull(e.target.value) ?? 0; set(i, { qty_received: q, allocate_qty: q }); }} />
                  <input className={cell} aria-label="PA HT" placeholder="PA HT" inputMode="decimal" value={l.unit_cost ?? ""} onChange={(e) => set(i, { unit_cost: numOrNull(e.target.value) })} />
                  <select className={cell} aria-label="État" value={l.condition} onChange={(e) => set(i, { condition: e.target.value as ReceiptLineInput["condition"] })}>
                    <option value="usable">Utilisable</option>
                    <option value="damaged_return">Endommagée</option>
                    <option value="to_check">À vérifier</option>
                  </select>
                  <select className={cell} aria-label="Destination" value={l.destination} onChange={(e) => set(i, { destination: e.target.value as ReceiptLineInput["destination"] })}>
                    <option value="or">Pour l'OR</option>
                    <option value="stock">Stock</option>
                    <option value="store_sale">Vente magasin</option>
                    <option value="unknown">Inconnue</option>
                  </select>
                  <button type="button" aria-label={ok ? "Ligne contrôlée" : "Marquer contrôlée"} title={ok ? "Contrôlée" : "À contrôler"} onClick={() => setChecked((c) => ({ ...c, [i]: !ok }))} className={`flex h-9 items-center justify-center gap-1 rounded-md border-2 px-2 text-xs font-extrabold uppercase ${ok ? "border-status-ok bg-status-ok text-primary-foreground" : "border-border"}`}>
                    <Check className="h-4 w-4" /><span className="md:hidden">{ok ? "Contrôlée" : "OK"}</span>
                  </button>
                </div>
                {anomalies.length ? <div className="mt-1 flex flex-wrap gap-1">{anomalies.map((a) => <Badge key={a} tone="warn">{a}</Badge>)}</div> : null}
                {l.destination === "or" && l.condition === "usable" && orv.or ? (
                  <label className="mt-1 flex items-center gap-2 text-xs">Qté à affecter à l'OR {orv.or.or_number}
                    <input className="h-8 w-20 rounded-md border-2 border-border bg-card px-2 text-xs" inputMode="decimal" value={l.allocate_qty} onChange={(e) => set(i, { allocate_qty: numOrNull(e.target.value) ?? 0 })} />
                  </label>
                ) : null}
              </div>
            );
          })}
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
