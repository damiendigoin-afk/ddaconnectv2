import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { DocDropZone } from "@/components/parts/DocDropZone";
import { orderMarker } from "@/lib/receipt-lines";
import { ActiveSiteNote, Badge, btnGhost, btnPrimary, inputCls, numOrNull, OrPicker, SiteMismatchAlert, SupplierSelect, usePartsCtx, useSuppliers } from "@/components/parts/PartsUi";
import { cancelReceipt, cancelReceiptIncident, findOrByNumber, getOrder, listOrders, listReceipts, listSupplierDocs, openRegularization, validateReceipt, type OrLite, type ReceiptLineInput } from "@/lib/parts";
import { CancelAction } from "@/components/parts/CancelAction";
import { ReceiptDocActions } from "@/components/parts/ReceiptDocActions";
import { listReceiptDocs } from "@/lib/receipt-docs";
import { receiptDocState } from "@/lib/receipt-docs-rules";
import { guessDocumentSite, matchSupplier, pendingReceptionOrders, receptionSuggestions, searchPendingOrders, supplierOpenOrders } from "@/lib/parts-site";
import { docSiteText, readPurchaseDoc } from "@/lib/purchase-doc";
import { getSupplierDoc, updateSupplierDoc, uploadSupplierDoc, type SupplierDoc } from "@/lib/supplier-docs";
import { ensureSupplierByName } from "@/lib/suppliers";
import { docSupplierId } from "@/lib/supplier-identify";
import { DocSupplierLink } from "@/components/parts/DocSupplierLink";
import { isOverReceipt } from "@/lib/parts-rules";
import { blankReceiptLine, lineAnomalies, receiptLinesFromDoc } from "@/lib/receipt-lines";
import { requestedDossier } from "@/lib/parts-site";
import { Check } from "lucide-react";
import { findFrenchPlate, formatPlate, normalizePlate, plateAfterOrderPick, winmotorOrHistory } from "@/lib/plate";
import { supabase } from "@/integrations/supabase/client";
import { OrderLinesCompact } from "@/components/parts/OrderLinesCompact";
import { defaultFreeReference, linesAfterOrderPick } from "@/lib/receipt-lines";

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
            {siteName(o.site_id)} · {orderMarker(o as never)} · {new Date(o.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
          </div>
          <OrderLinesCompact lines={o.part_order_lines ?? []} order={o as never} />
        </button>
      ))}
    </section>
  );
}

/** Rapprochement BL ↔ commandes en attente du site actif. Jamais bloquant : il y a toujours une étape suivante. */
export function DocMatch({ doc, onOrder, onNoOrder, onCancel }: { doc: SupplierDoc; onOrder: (id: string) => void; onNoOrder: () => void; onCancel: () => void }) {
  const { writeSite, sites } = usePartsCtx();
  const suppliers = useSuppliers();
  const x0 = doc.extracted;
  const x0p = x0.plate ?? findFrenchPlate([x0.handwritten_notes, ...(x0.lines ?? []).map((l) => l.label)].filter(Boolean).join(" | ")); const x = { ...x0, plate: x0p ? formatPlate(x0p) : null };
  const orders = useQuery({ queryKey: ["open-orders-match", writeSite], queryFn: () => listOrders({ siteId: writeSite }) });
  const sup = matchSupplier(x.supplier, suppliers.data ?? []) ?? (suppliers.data ?? []).find((s) => s.id === docSupplierId(x, suppliers.data ?? [])) ?? null;
  const xm = { ...x, supplier_id: x.supplier_id ?? sup?.id ?? null };
  const sugg = receptionSuggestions(xm, orders.data ?? [], writeSite);
  const supOpen = sugg.hasExact || sugg.probable.length ? [] : supplierOpenOrders(xm, orders.data ?? [], writeSite);
  const docLines = x.lines ?? [];
  const unread = [!x.supplier && !sup ? "fournisseur" : null, !(x.invoice_number || x.delivery_note_number || x.document_number) ? "n° document" : null, !x.document_date ? "date" : null, !docLines.length ? "lignes pièces" : null].filter(Boolean);
  const [manual, setManual] = useState(false);
  const [q, setQ] = useState("");
  const found = manual ? searchPendingOrders(orders.data ?? [], q, writeSite, 20, xm) : [];
  const orderBtn = (o: (typeof sugg.certain)[number]["order"], tone: "ok" | "warn" | null, reasons?: string[]) => {
    const meta = o as unknown as { comment?: string | null; created_by_name?: string | null; requested_or_number?: string | null; plate?: string | null; supplier_order_ref?: string | null; order_mode?: string | null };
    return (
      <div key={o.id} className="rounded-lg border-2 border-border p-2 text-left text-xs">
        {tone ? <><Badge tone={tone}>{tone === "ok" ? "Certaine" : "Correspondance probable"}</Badge>{" "}</> : null}
        {meta.order_mode === "simplified" ? <><Badge tone="muted">Front office</Badge>{" "}</> : null}
        <b>{(o.suppliers as { name: string } | null)?.name ?? "Fournisseur ?"}</b> · {orderMarker(o as never)} · {new Date(o.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
        {reasons?.length ? <span className="block font-semibold">Pourquoi : {reasons.join(" + ")}</span> : null}
        <span className="block text-muted-foreground">
          {meta.created_by_name ? `Créée par ${meta.created_by_name} · ` : ""}
          OR/dossier demandé : {meta.requested_or_number ?? (o.repair_orders as { or_number: string | null } | null)?.or_number ?? "—"} · Immat : {meta.plate ?? "—"} · N° commande fournisseur : {meta.supplier_order_ref ?? "—"}
        </span>
        {meta.comment ? <span className="block font-semibold">Commentaire : {meta.comment}</span> : null}
        <OrderLinesCompact lines={o.part_order_lines ?? []} order={(o.part_order_lines ?? []).length ? (o as never) : null} />
        <div className="mt-2 flex gap-2">
          <button type="button" className={`${btnPrimary} flex-1`} onClick={() => onOrder(o.id)}>Rapprocher</button>
          <Link to="/pieces-achats/commande/$orderId" params={{ orderId: o.id }} target="_blank" className={`${btnGhost} flex-1 text-center`}>Voir la commande</Link>
        </div>
      </div>
    );
  };
  return (
    <div className="card-surface space-y-3 p-4">
      <p className="text-xs font-extrabold uppercase text-muted-foreground">Document lu : {doc.file_name}</p>
      <SiteMismatchAlert docSite={guessDocumentSite(docSiteText(x), sites)} />
      <div className="text-xs space-y-1">
        {x.supplier ? <><p>Fournisseur lu : <b>{x.supplier}</b>{sup && sup.name !== x.supplier ? <> → fiche <b>{sup.name}</b></> : null}</p><DocSupplierLink extracted={x} docId={doc.id} /></> : <p>Fournisseur : <b>{sup?.name ?? "non lu"}</b></p>}
        <p>{x.doc_kind === "facture" ? "Facture" : x.doc_kind === "bl" ? "BL" : "Document"} n° <b>{x.invoice_number ?? x.delivery_note_number ?? x.document_number ?? "—"}</b> · Date : <b>{x.document_date ? new Date(x.document_date).toLocaleDateString("fr-FR") : "—"}</b> · N° commande fournisseur : <b>{x.order_reference ?? "—"}</b>{x.total_ht != null ? <> · Total HT : <b>{x.total_ht.toFixed(2)} €</b></> : null}{x.shipping_ht ? <> (dont port {x.shipping_ht.toFixed(2)} €)</> : null}</p>
        <p>Repères atelier (aides au rapprochement, facultatifs) — OR / dossier : <b>{x.or_number ?? "—"}</b> · Immat : <b>{x.plate ?? "—"}</b> · N° lus : <b>{[x.order_reference, ...(x.ref_candidates ?? [])].filter((v, i, a) => v && a.indexOf(v) === i).join(", ") || "—"}</b></p>
        {docLines.length ? (
          <ul className="rounded border border-border p-1">
            {docLines.map((l, i) => <li key={i}><b>{l.quantity ?? "?"} ×</b> {l.reference ?? "réf ?"} — {l.label ?? "—"}{l.unit_price != null ? ` · PU ${l.unit_price.toFixed(2)} €` : ""}</li>)}
          </ul>
        ) : null}
        {unread.length ? <p className="text-status-warn">Non lu (à compléter si besoin) : {unread.join(", ")}</p> : null}
      </div>
      {orders.isLoading ? <p className="text-sm text-muted-foreground">Recherche des commandes…</p> : null}

      {sugg.hasExact ? (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">Correspondance certaine</p>
          {sugg.certain.map((m) => orderBtn(m.order, "ok", m.reasons))}
        </div>
      ) : sugg.probable.length ? (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">{sugg.ambiguous ? "Plusieurs commandes possibles — choisissez la bonne" : "Correspondance probable — confirmez"}</p>
          {sugg.probable.map((m) => orderBtn(m.order, "warn", m.reasons))}
        </div>
      ) : supOpen.length ? (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">Commandes ouvertes de ce fournisseur — vérifiez avant de rapprocher</p>
          {supOpen.map((m) => orderBtn(m.order, "warn", m.reasons))}
        </div>
      ) : orders.data ? (
        <div className="rounded-lg border-2 border-status-warn p-3">
          <p className="text-sm font-extrabold">Aucun rapprochement exact trouvé</p>
          <p className="text-xs text-muted-foreground">Vous pouvez renseigner vos propres repères puis réceptionner quand même.</p>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <button className={`${btnPrimary} w-full`} onClick={onNoOrder}>{sugg.hasExact ? "Réceptionner sans commande" : "Continuer sans rapprochement"}</button>
        <button className={`${btnGhost} w-full`} onClick={() => setManual((v) => !v)}>Rechercher une commande manuellement</button>
      </div>

      {manual ? (
        <div className="space-y-2 rounded-lg border-2 border-border p-2">
          <p className="text-xs font-bold uppercase text-muted-foreground">Commandes correspondantes / récentes</p>
          <input className={inputCls} autoFocus placeholder="Fournisseur, n° commande, OR, immat, réf. pièce, désignation, commentaire / créateur" aria-label="Recherche de commande" value={q} onChange={(e) => setQ(e.target.value)} />
          <p className="text-xs text-muted-foreground">Toutes les commandes non soldées du site (détaillées, importées et front office), les plus proches du document en premier.</p>
          {orders.isLoading ? <p className="text-xs text-muted-foreground">Chargement des commandes…</p> : found.length ? found.map((o) => orderBtn(o, null)) : <p className="text-xs text-muted-foreground">{(orders.data ?? []).length ? "Aucune commande en attente ne correspond." : "Aucune commande en attente sur ce site."}</p>}
        </div>
      ) : null}

      {x.plate ? <PlateInfo plate={x.plate} /> : null}
      <button className="w-full text-xs underline" onClick={onCancel}>Annuler</button>
    </div>
  );
}

/** Immatriculation lue sur le document : véhicule, OR DDA et historique WinMotor connus (lecture seule, jamais de rattachement). */
function PlateInfo({ plate }: { plate: string }) {
  const key = normalizePlate(plate);
  const q = useQuery({
    queryKey: ["plate-info", key],
    queryFn: async () => {
      const [{ data: v }, { data: wm }] = await Promise.all([
        supabase.from("vehicles").select("id, brand, model").eq("plate_normalized", key).limit(1).maybeSingle(),
        supabase.from("winmotor_invoices").select("or_number, invoice_date").eq("plate_normalized", key).order("invoice_date", { ascending: false }).limit(20),
      ]);
      const { data: ors } = v ? await supabase.from("repair_orders").select("id, or_number").eq("vehicle_id", v.id).order("created_at", { ascending: false }).limit(3) : { data: [] };
      return { v, ors: ors ?? [], wm: winmotorOrHistory(wm ?? []) };
    },
  });
  const d = q.data;
  return (
    <div className="rounded-lg border-2 border-brand p-2 text-xs space-y-0.5">
      <p>Immatriculation détectée : <b>{plate}</b></p>
      {d?.v ? <p>Véhicule DDA : {[d.v.brand, d.v.model].filter(Boolean).join(" ") || "connu"}{d.ors.length ? ` · OR ${d.ors.map((o) => o.or_number ?? "en attente").join(", ")}` : ""}</p> : null}
      {d?.wm.length ? (
        <p>Véhicule connu dans l'historique WinMotor · dernier OR connu <b>{d.wm[0]!.or_number}</b> du {new Date(d.wm[0]!.date).toLocaleDateString("fr-FR")}
          {d.wm.length > 1 ? ` (précédents : ${d.wm.slice(1, 4).map((o) => o.or_number).join(", ")})` : ""} — historique, pas forcément l'OR en cours.</p>
      ) : null}
      {d && !d.v && !d.wm.length ? <p className="text-muted-foreground">Véhicule inconnu de la base et de WinMotor : la plaque sera conservée sur la réception pour rapprochement ultérieur.</p> : null}
    </div>
  );
}

function RecentReceipts() {
  const { siteName, actor, readSite } = usePartsCtx();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["part-receipts", readSite], queryFn: () => listReceipts(readSite) });
  const rows = q.data ?? [];
  const dq = useQuery({ queryKey: ["receipt-docs", rows.map((r) => `${r.id}:${r.source_document_id ?? ""}`).join(",")], enabled: rows.length > 0, queryFn: () => listReceiptDocs(rows) });
  return (
    <section className="space-y-2 pt-2">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Réceptions récentes</h2>
      {rows.map((r) => {
        const docs = dq.data?.get(r.id) ?? [];
        const ds = receiptDocState(r, docs);
        const orNum = (r.repair_orders as { or_number: string | null } | null)?.or_number ?? null;
        const supName = (r.suppliers as { name: string } | null)?.name ?? null;
        return (
        <div key={r.id} className={`rounded-xl border-2 border-border bg-card p-3 text-sm ${r.status === "cancelled" ? "opacity-60" : ""}`}>
          <div className="flex justify-between gap-2">
            <b className={r.status === "cancelled" ? "line-through" : ""}>{supName ?? "Fournisseur ?"}</b>
            {r.status === "cancelled" ? <Badge tone="bad">Annulée</Badge> : r.status === "incident" ? <Badge tone="bad">Incident</Badge> : ds === "awaiting" ? <Badge tone="warn">En attente de document</Badge> : ds === "invoice_to_check" ? <Badge tone="brand">Facture à contrôler</Badge> : ds === "doc_received" ? <Badge tone="ok">Document reçu</Badge> : <Badge tone="ok">Validée</Badge>}
          </div>
          <div className="text-xs text-muted-foreground">
            {siteName(r.site_id)} · {new Date(r.received_at).toLocaleString("fr-FR")} · {r.received_by_name}
            {orNum ? ` · OR ${orNum}` : ""}
            {r.plate ? ` · ${r.plate}` : ""}
          </div>
          <div className="text-xs">{(r.part_receipt_lines ?? []).map((l) => `${l.qty_received}× ${l.physical_reference ?? l.designation ?? "?"}`).join(", ") || r.comment}</div>
          {r.status === "cancelled" ? (
            <p className="text-xs font-bold">Annulée le {r.cancelled_at ? new Date(r.cancelled_at).toLocaleString("fr-FR") : "?"} par {r.cancelled_by_name ?? "?"} — {r.cancel_reason}</p>
          ) : null}
          {r.order_id ? <Link to="/pieces-achats/commande/$orderId" params={{ orderId: r.order_id }} className="text-xs underline">Voir la commande</Link> : null}
          {r.status !== "cancelled" ? (
            <ReceiptDocActions actor={actor} docs={docs} receipt={{ id: r.id, site_id: r.site_id, supplier_id: r.supplier_id, order_id: r.order_id, source_document_id: r.source_document_id, plate: r.plate, supplier_name: supName, or_number: orNum, lines: r.part_receipt_lines ?? [] }} />
          ) : null}
          {r.status === "validated" ? (
            <button className="ml-3 text-xs underline" onClick={async () => { const why = window.prompt("Incident (ex. livré au mauvais site) — motif :"); if (!why) return; await cancelReceiptIncident(r.id, r.site_id, why, actor); qc.invalidateQueries({ queryKey: ["part-receipts"] }); toast.success("Incident enregistré — pensez à corriger le stock si nécessaire."); }}>Signaler incident</button>
          ) : null}
          {r.status !== "cancelled" ? (
            <CancelAction
              label="Annuler la réception"
              warning={`Annuler cette réception ? Le stock sera remis dans l'état précédent par des mouvements inverses${r.order_id ? " et le reliquat de la commande sera rouvert" : ""}. L'historique est conservé.`}
              onConfirm={async (why) => {
                const res = await cancelReceipt(r.id, why, actor);
                void qc.invalidateQueries({ queryKey: ["part-receipts"] });
                void qc.invalidateQueries({ queryKey: ["part-orders"] });
                return `Réception annulée — ${res.reversed_movements} mouvement(s) de stock inversé(s)`;
              }}
            />
          ) : null}
        </div>
        );
      })}
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
  const [orv, setOrv] = useState<{ or: OrLite | null; plate: string; vehicleId: string | null }>({ or: null, plate: x.plate ? formatPlate(x.plate) : "", vehicleId: null });
  // Immat lue (y compris par le second passage) : préremplie sans attendre « Chercher », jamais écrasée si déjà saisie.
  useEffect(() => { if (x.plate) setOrv((v) => (v.plate.trim() ? v : { ...v, plate: formatPlate(x.plate!) })); }, [x.plate]);
  const [docId, setDocId] = useState(doc?.id ?? "");
  const [packages, setPackages] = useState("");
  const [comment, setComment] = useState("");
  const [dossier, setDossier] = useState(x.or_number ?? "");
  const [supplierRef, setSupplierRef] = useState(x.order_reference && x.order_reference !== x.or_number ? x.order_reference : "");
  const [freeRef, setFreeRef] = useState(defaultFreeReference(x as { customer_reference?: string | null }));
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [lines, setLines] = useState<ReceiptLineInput[]>(() => {
    if (mode === "order") return [];
    const fromDoc = receiptLinesFromDoc(x.lines);
    return fromDoc.length ? fromDoc : [blank()];
  });

  // Pré-remplissage depuis le BL : fournisseur connu et OR existant (jamais de création d'OR).
  useEffect(() => {
    if (!doc || mode === "order") return;
    if (x.or_number) void findOrByNumber(x.or_number).then((o) => { if (o) setOrv((v) => ({ or: o, plate: plateAfterOrderPick(v.plate, x.plate, o.plate, false), vehicleId: o.vehicle_id })); });
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
      setOrv({ or: o.repair_order_id ? { id: o.repair_order_id, or_number: (o.repair_orders as { or_number: string | null } | null)?.or_number ?? null, site_id: o.site_id, vehicle_id: o.vehicle_id, plate: o.plate } : null, plate: plateAfterOrderPick(orv.plate, x.plate, o.plate, false), vehicleId: o.vehicle_id });
      const dest = o.destination === "or" ? (o.repair_order_id ? "or" : "unknown") : o.destination;
      setLines(linesAfterOrderPick(o.part_order_lines ?? [], x.lines, dest as ReceiptLineInput["destination"]));
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
        plate: orv.plate.trim() ? formatPlate(orv.plate) : null,
        source_document_id: docId || null,
        receipt_type: docId ? "document" : "physical_without_document",
        packages: packages.trim() || null,
        comment: comment.trim() || null,
        requested_or_number: reqOr,
        supplier_order_ref: supplierRef.trim() || null,
        free_reference: freeRef.trim() || null,
        lines: lines.map((l) => ({ ...l, destination: l.destination === "or" && !orv.or ? "unknown" : l.destination })),
      }, actor);
      // Rien ne bloque : ce qui manque part dans « À régulariser », avec les repères saisis.
      const markers = [reqOr && `Dossier/OR ${reqOr}`, orv.plate.trim() && `Immat ${orv.plate.trim()}`, supplierRef.trim() && `Cde fournisseur ${supplierRef.trim()}`, freeRef.trim() && `Repère ${freeRef.trim()}`].filter(Boolean).join(" · ");
      if (!orderId && docId) await openRegularization({ site_id: site, kind: "reception_sans_commande", source_table: "part_receipts", source_id: receiptId, repair_order_id: orv.or?.id ?? null, supplier_id: supplierId, plate: orv.plate.trim() || null, comment: `Réception faite depuis un BL sans commande DDA${markers ? ` — ${markers}` : " — aucun repère saisi"}` }, actor);
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
              <b>{(o.suppliers as { name: string } | null)?.name}</b> · {orderMarker(o as never)} · {new Date(o.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
               <OrderLinesCompact lines={o.part_order_lines ?? []} order={o as never} />
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
          <div className="space-y-2 rounded-lg border-2 border-border p-2">
            <p className="text-xs font-bold uppercase text-muted-foreground">Vos repères (facultatifs, modifiables)</p>
            <OrPicker value={orv} onChange={setOrv} initialNumber={dossier || x.or_number || null} onNumberChange={setDossier} />
            {mode !== "order" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <input className={inputCls} placeholder="N° commande fournisseur" aria-label="N° commande fournisseur" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
                <input className={inputCls} placeholder="Repère libre / référence client" aria-label="Repère libre / référence client" value={freeRef} onChange={(e) => setFreeRef(e.target.value)} />
              </div>
            ) : null}
            {mode !== "order" && normalizePlate(orv.plate).length >= 5 ? <PlateInfo plate={orv.plate} /> : null}
          </div>
          {!orv.or ? (
            <p className="rounded-lg border-2 border-border bg-muted p-2 text-xs font-bold">
              {reqOr ? `Dossier ${reqOr} — aucun OR DDA rattaché : conservé pour le rapprochement à la facture WinMotor. ` : "Aucun OR DDA rattaché. "}La validation reste possible : les pièces entrent en stock et la réception part dans « À régulariser ».
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} placeholder="Colis / cartons (facultatif)" value={packages} onChange={(e) => setPackages(e.target.value)} />
            <input className={inputCls} placeholder="Commentaire" aria-label="Commentaire" value={comment} onChange={(e) => setComment(e.target.value)} />
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
