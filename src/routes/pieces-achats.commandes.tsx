import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { autoSupplier, initialOrderSupplier } from "@/lib/order-supplier";
import { findRefVehicleByPlate } from "@/lib/refbase";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { OrderRow } from "@/components/parts/OrderRow";
import { DocDropZone } from "@/components/parts/DocDropZone";
import { ActiveSiteNote, btnGhost, btnPrimary, inputCls, numOrNull, OrLink, PriceInput, OrPicker, SiteMismatchAlert, SupplierSelect, LogisticsBadge, usePartsCtx, useSuppliers } from "@/components/parts/PartsUi";
import { allocateToOr, createOrder, findOrByNumber, findStockByRef, listOrders, openRegularization, type OrderLineInput, type OrLite, type StockRow } from "@/lib/parts";
import { guessDocumentSite, matchSupplier, orderGaps, pendingReceptionOrders, requestedDossier, groupLinesByOr } from "@/lib/parts-site";
import { docSiteText, readPurchaseDoc, type ReadDoc } from "@/lib/purchase-doc";
import { DocSupplierLink } from "@/components/parts/DocSupplierLink";
import { ORDER_DOC_TYPE, uploadSupplierDoc } from "@/lib/supplier-docs";
import { linkDocToOrder } from "@/lib/order-docs";
import { logOrderLineContract, orderFormInitialState } from "@/lib/receipt-lines";
import { formatPlate } from "@/lib/plate";

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

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

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
            initialSupplier={doc ? initialOrderSupplier(doc.extracted, suppliers.data ?? []) : ""}
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

export function OrderForm({ doc, docSite, initialSupplier, onDone }: { doc: ReadDoc | null; docSite: string | null; initialSupplier: string; onDone: () => void }) {
  const { actor, writeSite, siteName } = usePartsCtx();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const x = doc?.extracted ?? {};
  const initial = orderFormInitialState(x, localToday());
  const [destination, setDestination] = useState<"or" | "store_sale" | "stock">("or");
  const [supplier, setSupplierRaw] = useState(initialSupplier);
  const [supplierTouched, setSupplierTouched] = useState(false);
  const setSupplier = (v: string) => { setSupplierTouched(true); setSupplierRaw(v); };
  const suppliersQ = useSuppliers();
  useEffect(() => {
    const next = autoSupplier(supplier, supplierTouched, x.supplier, suppliersQ.data);
    if (next !== supplier) setSupplierRaw(next);
  }, [suppliersQ.data, supplier, supplierTouched, x.supplier]);
  const [orv, setOrv] = useState<{ or: OrLite | null; plate: string; vehicleId: string | null }>({ or: null, plate: initial.plate, vehicleId: null });
  const [comment, setComment] = useState("");
  // Date de commande : lue sur le document, sinon date du jour locale ; toujours modifiable.
  // Mémorisée automatiquement (document sinon jour de validation), non affichée.
  const [orderDate] = useState(initial.orderDate);
  const [appointment, setAppointment] = useState("");
  const [delivery, setDelivery] = useState(x.expected_delivery_date ?? "");
  const [supRef, setSupRef] = useState(initial.supplierOrderRef);
  const [dossier, setDossier] = useState(initial.dossier);
  const [lines, setLines] = useState<OrderLineInput[]>(() => {
    const ls = initial.lines;
    return ls.length ? ls : doc ? [emptyLine()] : [];
  });
  useEffect(() => { logOrderLineContract("form-state", x, lines); }, []);
  // Commande fournisseur multi-OR : un repère OR par ligne (une commande DDA par OR à la validation).
  const multiOrs = (x.or_numbers ?? []).length > 1 ? x.or_numbers! : [];
  const [lineOrs, setLineOrs] = useState<string[]>(() => initial.lines.map(() => multiOrs[0] ?? ""));
  const [orFound, setOrFound] = useState<Record<string, OrLite | null>>({});
  useEffect(() => {
    if (!multiOrs.length) return;
    let live = true;
    void Promise.all(multiOrs.map(async (n) => [n, await findOrByNumber(n)] as const)).then((r) => { if (live) setOrFound(Object.fromEntries(r)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiOrs.join("|")]);
  const removeLine = (i: number) => { setLines((ls) => ls.filter((_, j) => j !== i)); setLineOrs((a) => a.filter((_, j) => j !== i)); };
  const [stockHits, setStockHits] = useState<Record<number, StockRow[]>>({});
  const [busy, setBusy] = useState(false);
  const [orLooked, setOrLooked] = useState(false);
  const [vehFound, setVehFound] = useState<string | null>(null);

  // OR lu sur le document : rattachement automatique s'il existe dans DDA (jamais de création d'OR).
  // Sinon, plaque imprimée → véhicule DDA rattaché ; le n° de dossier est conservé ; la facture WinMotor confirmera.
  if (doc && !orLooked && (x.or_number || x.plate)) {
    setOrLooked(true);
    void (async () => {
      const o = x.or_number ? await findOrByNumber(x.or_number) : null;
      if (o) return setOrv({ or: o, plate: formatPlate(o.plate ?? orv.plate), vehicleId: o.vehicle_id });
      if (!x.plate) return;
      const v = await findRefVehicleByPlate(x.plate);
      if (v) {
        const disp = formatPlate((v as { registration_display?: string | null }).registration_display ?? x.plate ?? "");
        setOrv((cur) => (cur.or ? cur : { or: null, plate: disp, vehicleId: v.id }));
        setVehFound(disp);
      }
    })();
  }
  const requestedOr = requestedDossier(orv.or, dossier);

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
    removeLine(i);
    setStockHits({});
  }

  async function submit() {
    if (!writeSite) return void toast.error("Choisissez le site actif dans la barre du haut.");
    setBusy(true);
    try {
      let docId: string | null = null;
      if (doc) {
        try {
          docId = (await uploadSupplierDoc({ file: doc.file, extracted: { ...doc.extracted, supplier_id: supplier || doc.extracted.supplier_id || null }, siteId: writeSite, userId: actor.userId, userName: actor.name, docType: ORDER_DOC_TYPE })).id;
        } catch (e) {
          toast.warning(`Document non archivé (${e instanceof Error ? e.message : "erreur"}) : la commande est tout de même enregistrée.`);
        }
      }
      const clean = lines.filter((l) => l.physical_reference.trim() || l.designation.trim());
      const plate = orv.plate.trim() || orv.or?.plate || null;
      if (multiOrs.length) {
        const tagged = lines.map((l, i) => ({ l, or: lineOrs[i] || null })).filter(({ l }) => l.physical_reference.trim() || l.designation.trim());
        const groups = groupLinesByOr(multiOrs, tagged);
        const ids: string[] = [];
        let gapCount = 0;
        for (const g of groups.length ? groups : [{ or: multiOrs[0]!, lines: [] as typeof tagged }]) {
          const ro = orFound[g.or] ?? (await findOrByNumber(g.or));
          const reqOr = requestedDossier(ro, g.or);
          const gl = g.lines.map((t) => t.l);
          const oid = await createOrder({
            site_id: writeSite, supplier_id: supplier || null, source_document_id: docId,
            order_mode: gl.length ? "detailed" : "simplified", destination,
            repair_order_id: ro?.id ?? null, vehicle_id: ro?.vehicle_id ?? orv.vehicleId,
            plate: ro?.plate ?? plate, appointment_date: appointment || null, expected_delivery_date: delivery || null, order_date: orderDate || null, supplier_order_ref: supRef.trim() || null,
            comment: [comment.trim(), `Commande fournisseur multi-OR : ${multiOrs.join(" + ")}`].filter(Boolean).join(" — "),
            requested_or_number: reqOr, lines: gl,
          }, actor);
          ids.push(oid);
          if (docId && ids.length === 1) await linkDocToOrder(docId, oid).catch(() => undefined);
          const gaps = orderGaps({ supplier_id: supplier || null, hasDocument: !!doc, lines: gl.length, repair_order_id: ro?.id ?? null, plate: ro?.plate ?? plate, destination, requested_or_number: reqOr });
          gapCount += gaps.length;
          for (const kind of gaps) await openRegularization({ site_id: writeSite, kind, source_table: "part_orders", source_id: oid, repair_order_id: ro?.id ?? null, supplier_id: supplier || null, plate: ro?.plate ?? plate, comment: "Commande validée avec informations manquantes" }, actor);
        }
        toast.success(`${ids.length} commande(s) enregistrée(s), une par OR${gapCount ? ` — ${gapCount} point(s) dans « À régulariser »` : ""}`);
        qc.invalidateQueries({ queryKey: ["part-orders"] });
        onDone();
        void navigate({ to: "/pieces-achats/commande/$orderId", params: { orderId: ids[0]! } });
        return;
      }
      const id = await createOrder({
        site_id: writeSite,
        supplier_id: supplier || null,
        source_document_id: docId,
        order_mode: clean.length ? "detailed" : "simplified",
        destination,
        repair_order_id: orv.or?.id ?? null,
        vehicle_id: orv.vehicleId,
        plate,
        appointment_date: appointment || null, expected_delivery_date: delivery || null, order_date: orderDate || null,
        supplier_order_ref: supRef.trim() || null,
        comment: comment.trim() || null,
        requested_or_number: requestedOr,
        lines: clean,
      }, actor);
      if (docId) await linkDocToOrder(docId, id).catch(() => undefined);
      const gaps = orderGaps({ supplier_id: supplier || null, hasDocument: !!doc, lines: clean.length, repair_order_id: orv.or?.id ?? null, plate, destination, requested_or_number: requestedOr });
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
      <div className="card-surface space-y-3 p-4" data-import-contract-version="2026-09-29.2">
      <p className="text-xs font-extrabold uppercase text-muted-foreground">
        {doc ? `Contrôle du document : ${doc.file.name}` : "Saisie manuelle rapide"} · site {writeSite ? siteName(writeSite) : "?"}
      </p>
      {doc ? <SiteMismatchAlert docSite={docSite} /> : null}
      {doc && !supplier ? <DocSupplierLink extracted={x} onLinked={(id) => { void qc.invalidateQueries({ queryKey: ["suppliers-list"] }); setSupplier(id); }} /> : null}
      <SupplierSelect value={supplier} onChange={setSupplier} />
      {!supplier && x.supplier ? (
        <p className="rounded-lg border-2 border-status-watch bg-status-watch-soft p-2 text-xs font-bold">
          Fournisseur lu sur le document : « {x.supplier} » — aucun fournisseur existant ne correspond. Choisissez-le dans la liste ou créez-le dans Paramétrage › Fournisseurs.
        </p>
      ) : null}
      {!supplier ? <p className="text-xs text-muted-foreground">Fournisseur facultatif : s'il manque, la commande part dans « À régulariser ».</p> : null}
      {x.document_date ? <p className="text-xs font-bold text-muted-foreground">Document du {x.document_date.split("-").reverse().join("/")}</p> : null}
      {multiOrs.length ? (
        <div className="space-y-2 rounded-lg border-2 border-border bg-muted p-2 text-xs">
          <p className="font-extrabold uppercase">Repères OR : {multiOrs.join(" + ")}</p>
          <ul className="space-y-0.5">
            {multiOrs.map((n) => (
              <li key={n}>OR {n} — {n in orFound ? (orFound[n] ? `dossier trouvé${orFound[n]!.plate ? ` · ${orFound[n]!.plate}` : ""}` : "sera rapproché à la facture WinMotor") : "recherche…"}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">Choisissez l'OR de chaque ligne : une commande sera créée par OR, avec le même n° de commande fournisseur.</p>
          <input className={inputCls} placeholder="Immatriculation" value={orv.plate} onChange={(e) => setOrv({ ...orv, plate: e.target.value })} />
        </div>
      ) : (
        <OrPicker value={orv} onChange={setOrv} initialNumber={x.or_number ?? null} onNumberChange={setDossier} />
      )}
      {!multiOrs.length && requestedOr ? (
        <p className="rounded-lg border-2 border-border bg-muted p-2 text-xs font-bold">
          Dossier {requestedOr}{vehFound ? ` · véhicule ${vehFound}` : ""} — sera rapproché à la facture WinMotor.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} placeholder="N° commande fournisseur" value={supRef} onChange={(e) => setSupRef(e.target.value)} />
        <span />
        <label className="text-xs font-bold">Date de RDV<input className={inputCls} type="date" value={appointment} onChange={(e) => setAppointment(e.target.value)} aria-label="Date de RDV" /></label>
        <label className="text-xs font-bold">Livraison prévue<input className={inputCls} type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} aria-label="Livraison prévue" /></label>
      </div>
      <LogisticsBadge order={{ appointment_date: appointment, expected_delivery_date: delivery, status: "ordered" }} />
      {x.control_alerts?.length ? (
        <div role="alert" className="space-y-0.5 rounded-lg border-2 border-destructive bg-destructive/10 p-2 text-xs font-bold">
          <p className="uppercase">Contrôle du document — à corriger avant validation</p>
          {x.control_alerts.map((a) => <p key={a}>• {a}</p>)}
        </div>
      ) : null}
      {x.vehicle_label ? <p className="text-xs text-muted-foreground">Véhicule : {x.vehicle_label}</p> : null}
      <select className={inputCls} value={destination} onChange={(e) => setDestination(e.target.value as typeof destination)}>
        <option value="or">Destination : OR</option>
        <option value="store_sale">Destination : vente magasin</option>
        <option value="stock">Destination : stock</option>
      </select>
      <textarea className={`${inputCls} h-16 py-2`} placeholder="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="hidden grid-cols-[0.75fr_1.25fr_2fr_0.55fr_0.75fr_auto] gap-1 px-1 text-[10px] font-extrabold uppercase text-muted-foreground md:grid">
        <span>Type</span><span>Référence</span><span>Désignation</span><span>Qté</span><span>PA HT</span><span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="rounded-lg border-2 border-border p-2 md:p-1">
          <div className="grid grid-cols-2 gap-1 md:grid-cols-[0.75fr_1.25fr_2fr_0.55fr_0.75fr_auto] md:items-center">
            <select aria-label="Type de ligne" className={`${inputCls} h-9 px-2 text-xs`} value={l.line_kind} onChange={(e) => setLine(i, { line_kind: e.target.value as OrderLineInput["line_kind"] })}>
              <option value="part">Pièce</option>
              <option value="fee">Frais</option>
              <option value="deposit">Consigne</option>
            </select>
            <input aria-label="Référence" className={`${inputCls} h-9 px-2 text-xs`} placeholder="Référence" value={l.physical_reference} onBlur={(e) => l.line_kind === "part" && checkStock(i, e.target.value)} onChange={(e) => setLine(i, { physical_reference: e.target.value })} />
            <input aria-label="Désignation" className={`${inputCls} order-first col-span-2 h-9 px-2 text-xs md:order-none md:col-span-1`} placeholder="Désignation" value={l.designation} onChange={(e) => setLine(i, { designation: e.target.value })} />
            <input aria-label="Quantité" className={`${inputCls} h-9 px-2 text-xs`} inputMode="decimal" placeholder="Qté" value={l.qty_ordered ?? ""} onChange={(e) => setLine(i, { qty_ordered: numOrNull(e.target.value) })} />
            <PriceInput aria-label="PA HT" className={`${inputCls} h-9 px-2 text-xs`} placeholder="PA HT" value={l.expected_unit_cost_ht} onChange={(n) => setLine(i, { expected_unit_cost_ht: n })} />
            <button type="button" className="flex h-9 items-center justify-center rounded-md border-2 border-border px-2" aria-label="Supprimer la ligne" title="Supprimer la ligne" onClick={() => removeLine(i)}><Trash2 className="h-4 w-4" /></button>
          </div>
          {multiOrs.length ? (
            <select aria-label="OR de la ligne" className={`${inputCls} mt-1 h-9 px-2 text-xs`} value={lineOrs[i] || multiOrs[0]} onChange={(e) => setLineOrs((a) => { const b = [...a]; b[i] = e.target.value; return b; })}>
              {multiOrs.map((n) => <option key={n} value={n}>Pour l'OR {n}</option>)}
            </select>
          ) : null}
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
      <button type="button" className={btnGhost} onClick={() => { setLines((ls) => [...ls, emptyLine()]); setLineOrs((a) => [...a, multiOrs[0] ?? ""]); }}>+ Ligne</button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btnGhost} onClick={onDone}>Annuler</button>
        <button type="button" className={btnPrimary} onClick={submit} disabled={busy}>Valider la commande</button>
      </div>
    </div>
  );
}

export { OrLink };
