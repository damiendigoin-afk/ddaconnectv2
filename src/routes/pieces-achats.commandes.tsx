import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { OrderRow } from "@/components/parts/OrderRow";
import { DocDropZone } from "@/components/parts/DocDropZone";
import { ActiveSiteNote, btnGhost, btnPrimary, inputCls, numOrNull, OrLink, OrPicker, SiteMismatchAlert, SupplierSelect, usePartsCtx, useSuppliers } from "@/components/parts/PartsUi";
import { allocateToOr, createOrder, findOrByNumber, findStockByRef, listOrders, openRegularization, type OrderLineInput, type OrLite, type StockRow } from "@/lib/parts";
import { guessDocumentSite, matchSupplier, orderGaps, pendingReceptionOrders } from "@/lib/parts-site";
import { docSiteText, readPurchaseDoc, type ReadDoc } from "@/lib/purchase-doc";
import { ORDER_DOC_TYPE, uploadSupplierDoc } from "@/lib/supplier-docs";

export const Route = createFileRoute("/pieces-achats/commandes")({
  head: () => ({
    meta: [
      { title: "Commander des pièces — DDA Connect" },
      { name: "description", content: "Commande fournisseur par dépôt du bon de commande, contrôle rapide et validation sur le site actif." },
      { property: "og:title", content: "Commander des pièces — DDA Connect" },
      { property: "og:description", content: "Commandes fournisseurs de l'atelier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersPage,
});

const emptyLine = (): OrderLineInput => ({ line_kind: "part", physical_reference: "", designation: "", qty_ordered: 1, expected_unit_cost_ht: null });

function OrdersPage() {
  const { sites } = usePartsCtx();
  const suppliers = useSuppliers();
  const [doc, setDoc] = useState<ReadDoc | null>(null);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    const r = await readPurchaseDoc(file);
    if (r.warning) toast.warning(r.warning);
    setDoc(r);
    setBusy(false);
  }

  const done = () => { setDoc(null); setManual(false); };

  return (
    <AppShell title="Commander des pièces" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      <div className="space-y-3">
        <ActiveSiteNote />
        {doc || manual ? (
          <OrderForm
            key={doc?.file.name ?? "manual"}
            doc={doc}
            docSite={doc ? guessDocumentSite(docSiteText(doc.extracted), sites) : null}
            initialSupplier={doc ? matchSupplier(doc.extracted.supplier, suppliers.data ?? [])?.id ?? "" : ""}
            onDone={done}
          />
        ) : (
          <>
            <DocDropZone title="Importer un bon de commande" hint="PDF, scan, photo ou capture d'écran du site fournisseur — glissez-déposez ici" busy={busy} onFile={onFile} />
            <button type="button" className="w-full text-center text-sm font-bold underline" onClick={() => setManual(true)}>
              Pas de document ? Saisie manuelle rapide
            </button>
            <PendingOrders />
          </>
        )}
      </div>
    </AppShell>
  );
}

function PendingOrders() {
  const { readSite, siteName } = usePartsCtx();
  const q = useQuery({ queryKey: ["part-orders", readSite, "pending"], queryFn: async () => pendingReceptionOrders(await listOrders({ siteId: readSite })) });
  return (
    <section className="space-y-2 pt-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase text-muted-foreground">Commandes en attente de réception</h2>
        <Link to="/pieces-achats/historique" className="text-xs font-bold underline">Historique</Link>
      </div>
      {q.data && !q.data.length ? <p className="card-surface p-3 text-sm text-muted-foreground">Aucune commande en attente.</p> : null}
      {(q.data ?? []).slice(0, 15).map((o) => <OrderRow key={o.id} o={o} siteName={siteName} />)}
    </section>
  );
}

function OrderForm({ doc, docSite, initialSupplier, onDone }: { doc: ReadDoc | null; docSite: string | null; initialSupplier: string; onDone: () => void }) {
  const { actor, writeSite, siteName } = usePartsCtx();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const x = doc?.extracted ?? {};
  const [destination, setDestination] = useState<"or" | "store_sale" | "stock">("or");
  const [supplier, setSupplier] = useState(initialSupplier);
  const [orv, setOrv] = useState<{ or: OrLite | null; plate: string; vehicleId: string | null }>({ or: null, plate: x.plate ?? "", vehicleId: null });
  const [comment, setComment] = useState(x.supplier && !initialSupplier ? `Fournisseur lu : ${x.supplier}` : "");
  const [rdv, setRdv] = useState("");
  const [supRef, setSupRef] = useState(x.order_reference ?? x.document_number ?? "");
  const [lines, setLines] = useState<OrderLineInput[]>(() => {
    const ls = (x.lines ?? []).filter((l) => l.reference || l.label).map((l) => ({ line_kind: "part" as const, physical_reference: l.reference ?? "", designation: [l.label, l.delay ? `(délai : ${l.delay})` : ""].filter(Boolean).join(" "), qty_ordered: l.quantity ?? 1, expected_unit_cost_ht: l.unit_price ?? null }));
    return ls.length ? ls : doc ? [emptyLine()] : [];
  });
  const [stockHits, setStockHits] = useState<Record<number, StockRow[]>>({});
  const [busy, setBusy] = useState(false);
  const [orLooked, setOrLooked] = useState(false);

  // OR lu sur le document : rattachement automatique s'il existe dans DDA (jamais de création d'OR).
  if (doc && !orLooked && x.or_number) {
    setOrLooked(true);
    void findOrByNumber(x.or_number).then((o) => { if (o) setOrv({ or: o, plate: o.plate ?? orv.plate, vehicleId: o.vehicle_id }); });
  }

  const setLine = (i: number, p: Partial<OrderLineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));

  async function checkStock(i: number, ref: string) {
    if (!ref.trim() || !writeSite) return;
    const hits = (await findStockByRef(writeSite, ref)).filter((h) => h.available_qty > 0);
    setStockHits((s) => ({ ...s, [i]: hits }));
  }

  async function allocateHit(i: number, h: StockRow) {
    if (!orv.or) return void toast.error("Rattachez d'abord un OR WinMotor.");
    const qty = lines[i]?.qty_ordered ?? 1;
    await allocateToOr({ articleId: h.id, siteId: h.site_id, orId: orv.or.id, qty, ref: h.physical_reference, designation: h.designation }, actor);
    toast.success(`${qty} × ${h.physical_reference} affecté(s) à l'OR ${orv.or.or_number}`);
    setLines((ls) => ls.filter((_, j) => j !== i));
    setStockHits({});
  }

  async function submit() {
    if (!writeSite) return void toast.error("Choisissez le site actif dans la barre du haut.");
    setBusy(true);
    try {
      let docId: string | null = null;
      if (doc) {
        try {
          docId = (await uploadSupplierDoc({ file: doc.file, extracted: doc.extracted, siteId: writeSite, userId: actor.userId, userName: actor.name, docType: ORDER_DOC_TYPE })).id;
        } catch (e) {
          toast.warning(`Document non archivé (${e instanceof Error ? e.message : "erreur"}) : la commande est tout de même enregistrée.`);
        }
      }
      const clean = lines.filter((l) => l.physical_reference.trim() || l.designation.trim());
      const plate = orv.plate.trim() || orv.or?.plate || null;
      const id = await createOrder({
        site_id: writeSite,
        supplier_id: supplier || null,
        source_document_id: docId,
        order_mode: clean.length ? "detailed" : "simplified",
        destination,
        repair_order_id: orv.or?.id ?? null,
        vehicle_id: orv.vehicleId,
        plate,
        appointment_date: rdv || null,
        supplier_order_ref: supRef.trim() || null,
        comment: comment.trim() || null,
        lines: clean,
      }, actor);
      const gaps = orderGaps({ supplier_id: supplier || null, hasDocument: !!doc, lines: clean.length, repair_order_id: orv.or?.id ?? null, plate, destination });
      for (const kind of gaps) {
        await openRegularization({ site_id: writeSite, kind, source_table: "part_orders", source_id: id, repair_order_id: orv.or?.id ?? null, supplier_id: supplier || null, plate, comment: "Commande validée avec informations manquantes" }, actor);
      }
      toast.success(gaps.length ? `Commande enregistrée — ${gaps.length} point(s) envoyé(s) dans « À régulariser »` : "Commande enregistrée — en attente de réception");
      qc.invalidateQueries({ queryKey: ["part-orders"] });
      onDone();
      void navigate({ to: "/pieces-achats/commande/$orderId", params: { orderId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface space-y-3 p-4">
      <p className="text-xs font-extrabold uppercase text-muted-foreground">
        {doc ? `Contrôle du document : ${doc.file.name}` : "Saisie manuelle rapide"} · site {writeSite ? siteName(writeSite) : "?"}
      </p>
      {doc ? <SiteMismatchAlert docSite={docSite} /> : null}
      <SupplierSelect value={supplier} onChange={setSupplier} />
      {!supplier && x.supplier ? (
        <p className="rounded-lg border-2 border-status-watch bg-status-watch-soft p-2 text-xs font-bold">
          Fournisseur lu sur le document : « {x.supplier} » — aucun fournisseur existant ne correspond. Choisissez-le dans la liste ou créez-le dans Paramétrage › Fournisseurs.
        </p>
      ) : null}
      {!supplier ? <p className="text-xs text-muted-foreground">Fournisseur facultatif : s'il manque, la commande part dans « À régulariser ».</p> : null}
      <OrPicker value={orv} onChange={setOrv} />
      {doc && x.or_number && !orv.or ? <p className="text-xs text-muted-foreground">OR lu sur le document : {x.or_number} (non trouvé dans DDA).</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="N° commande fournisseur" value={supRef} onChange={(e) => setSupRef(e.target.value)} />
        <input className={inputCls} type="date" value={rdv} onChange={(e) => setRdv(e.target.value)} aria-label="Date RDV" title="Date RDV (facultative)" />
      </div>
      <select className={inputCls} value={destination} onChange={(e) => setDestination(e.target.value as typeof destination)}>
        <option value="or">Destination : OR</option>
        <option value="store_sale">Destination : vente magasin</option>
        <option value="stock">Destination : stock</option>
      </select>
      <textarea className={`${inputCls} h-16 py-2`} placeholder="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {lines.map((l, i) => (
        <div key={i} className="space-y-2 rounded-lg border-2 border-border p-2">
          <div className="flex gap-2">
            <select className={`${inputCls} w-28`} value={l.line_kind} onChange={(e) => setLine(i, { line_kind: e.target.value as OrderLineInput["line_kind"] })}>
              <option value="part">Pièce</option>
              <option value="fee">Frais</option>
              <option value="deposit">Consigne</option>
            </select>
            <input className={inputCls} placeholder="Référence" value={l.physical_reference} onBlur={(e) => l.line_kind === "part" && checkStock(i, e.target.value)} onChange={(e) => setLine(i, { physical_reference: e.target.value })} />
            <button type="button" aria-label="Supprimer la ligne" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
          <input className={inputCls} placeholder="Désignation" value={l.designation} onChange={(e) => setLine(i, { designation: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className={inputCls} inputMode="decimal" placeholder="Qté" value={l.qty_ordered ?? ""} onChange={(e) => setLine(i, { qty_ordered: numOrNull(e.target.value) })} />
            <input className={inputCls} inputMode="decimal" placeholder="PA HT" value={l.expected_unit_cost_ht ?? ""} onChange={(e) => setLine(i, { expected_unit_cost_ht: numOrNull(e.target.value) })} />
          </div>
          {stockHits[i]?.length ? (
            <div className="rounded-lg border-2 border-status-watch bg-status-watch-soft p-2 text-xs">
              <p className="font-extrabold uppercase">Pièce déjà en stock</p>
              {stockHits[i]!.map((h) => (
                <div key={h.id} className="mt-1 flex flex-wrap items-center gap-2">
                  <span>{h.physical_reference} · dispo {h.available_qty}{h.location ? ` · ${h.location}` : ""}</span>
                  <button type="button" className="underline" onClick={() => allocateHit(i, h)}>Affecter au dossier</button>
                  <button type="button" className="underline" onClick={() => setStockHits((s) => ({ ...s, [i]: [] }))}>Commander quand même</button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
      <button type="button" className={btnGhost} onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ Ligne</button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btnGhost} onClick={onDone}>Annuler</button>
        <button type="button" className={btnPrimary} onClick={submit} disabled={busy}>Valider la commande</button>
      </div>
    </div>
  );
}

export { OrLink };
