import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { btnGhost, btnPrimary, inputCls, numOrNull, OrPicker, PriceInput, SupplierSelect, usePartsCtx } from "@/components/parts/PartsUi";
import { findOrByNumber, invoicedOrderLineIds, updateOrder, type OrLite } from "@/lib/parts";
import { checkOrderEdit, editPayloadLines, isEngaged, type EditableLine, type ExistingLine } from "@/lib/order-edit-rules";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = EditableLine & { or_text: string };

/** Modification manuelle d'une commande existante (y compris validée / partiellement reçue). Aucun appel OCR/IA. */
export function OrderEditForm({ o, onDone }: { o: any; onDone: () => void }) {
  const { actor } = usePartsCtx();
  const qc = useQueryClient();
  const src = (o.part_order_lines ?? []) as any[];
  const inv = useQuery({ queryKey: ["order-invoiced", o.id], queryFn: () => invoicedOrderLineIds(src.map((l) => l.id)) });
  const before: ExistingLine[] = src.map((l) => ({
    id: l.id, line_kind: l.line_kind, physical_reference: l.physical_reference ?? "", designation: l.designation ?? "",
    qty_ordered: l.qty_ordered == null ? null : Number(l.qty_ordered), expected_unit_cost_ht: l.expected_unit_cost_ht == null ? null : Number(l.expected_unit_cost_ht),
    qty_received: Number(l.qty_received ?? 0), status: l.status, invoiced: inv.data?.has(l.id) ?? false,
    repair_order_id: l.repair_order_id ?? null, requested_or_number: l.requested_or_number ?? null,
  }));
  const [supplier, setSupplier] = useState<string>(o.supplier_id ?? "");
  const [supRef, setSupRef] = useState<string>(o.supplier_order_ref ?? "");
  const [orderDate] = useState<string>(o.order_date ?? "");
  const [comment, setComment] = useState<string>(o.comment ?? "");
  const [destination, setDestination] = useState<"or" | "store_sale" | "stock">(o.destination ?? "or");
  const initialOr: OrLite | null = o.repair_order_id ? { id: o.repair_order_id, or_number: o.repair_orders?.or_number ?? null, site_id: o.site_id, vehicle_id: o.vehicle_id ?? null, plate: o.plate ?? null } : null;
  const [orv, setOrv] = useState<{ or: OrLite | null; plate: string; vehicleId: string | null }>({ or: initialOr, plate: o.plate ?? "", vehicleId: o.vehicle_id ?? null });
  const [dossier, setDossier] = useState<string>(o.repair_orders?.or_number ?? o.requested_or_number ?? "");
  const [rows, setRows] = useState<Row[]>(() => before.map((l) => ({ ...l, or_text: l.requested_or_number ?? "" })));
  const [busy, setBusy] = useState(false);
  const engagedById = new Map(before.map((l) => [l.id, isEngaged(l)]));
  const setRow = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  async function save() {
    const orId = orv.or?.id ?? null;
    const check = checkOrderEdit(before, rows, {
      hasReceipts: (o.receipts ?? []).some((r: any) => r.status !== "cancelled"),
      orChanged: orId !== (o.repair_order_id ?? null), destinationChanged: destination !== o.destination,
      supplierChanged: (supplier || null) !== (o.supplier_id ?? null), invoiceLinked: (inv.data?.size ?? 0) > 0,
    });
    if (check.errors.length) { toast.error(check.errors.join(" · ")); return; }
    setBusy(true);
    try {
      const resolved: EditableLine[] = [];
      for (const r of rows) {
        const n = r.or_text.trim();
        let repair_order_id: string | null = null;
        if (n) { const f = await findOrByNumber(n); repair_order_id = f && (!f.site_id || f.site_id === o.site_id) ? f.id : null; }
        resolved.push({ ...r, repair_order_id, requested_or_number: n || null });
      }
      const res = await updateOrder(o, {
        supplier_id: supplier || null, supplier_order_ref: supRef, order_date: orderDate || null, comment, destination,
        repair_order_id: orId, vehicle_id: orv.vehicleId ?? orv.or?.vehicle_id ?? null, plate: orv.plate.trim() || null,
        requested_or_number: orId ? null : dossier.trim() || null,
      }, editPayloadLines(resolved), actor);
      toast.success("Commande modifiée");
      for (const w of [...new Set([...check.warnings, ...(res.warnings ?? [])])]) toast.warning(w);
      void qc.invalidateQueries({ queryKey: ["part-order", o.id] });
      void qc.invalidateQueries({ queryKey: ["part-orders"] });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Modification impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-surface space-y-3 p-4" data-testid="order-edit">
      <p className="text-xs font-extrabold uppercase text-muted-foreground">Modifier la commande</p>
      {(o.receipts ?? []).some((r: any) => r.status !== "cancelled") || (inv.data?.size ?? 0) > 0 ? (
        <p className="rounded-lg border-2 border-status-watch bg-status-watch-soft p-2 text-xs font-bold">
          Commande déjà reçue{(inv.data?.size ?? 0) > 0 ? " / facturée" : ""} : les lignes marquées d'un cadenas gardent leur référence et leur type, leur quantité ne peut pas descendre sous le déjà reçu, et elles ne peuvent pas être supprimées. Le stock et les factures ne sont jamais modifiés ici.
        </p>
      ) : null}
      <SupplierSelect value={supplier} onChange={setSupplier} />
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} aria-label="N° commande fournisseur" placeholder="N° commande fournisseur" value={supRef} onChange={(e) => setSupRef(e.target.value)} />

      </div>
      <OrPicker value={orv} onChange={setOrv} initialNumber={dossier || null} onNumberChange={setDossier} />
      <select className={inputCls} aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value as typeof destination)}>
        <option value="or">Destination : OR</option>
        <option value="store_sale">Destination : vente magasin</option>
        <option value="stock">Destination : stock</option>
      </select>
      <textarea className={`${inputCls} h-16 py-2`} aria-label="Commentaire" placeholder="Commentaire" value={comment} onChange={(e) => setComment(e.target.value)} />
      {rows.map((l, i) => {
        const locked = !!(l.id && engagedById.get(l.id));
        const b = before.find((x) => x.id === l.id);
        return (
          <div key={l.id ?? `new-${i}`} className="space-y-1 rounded-lg border-2 border-border p-2">
            <div className="grid grid-cols-2 gap-1 md:grid-cols-[0.75fr_1.25fr_2fr_0.55fr_0.75fr_auto] md:items-center">
              <select aria-label="Type de ligne" disabled={locked} className={`${inputCls} h-9 px-2 text-xs`} value={l.line_kind} onChange={(e) => setRow(i, { line_kind: e.target.value as Row["line_kind"] })}>
                <option value="part">Pièce</option><option value="fee">Frais</option><option value="deposit">Consigne</option>
              </select>
              <input aria-label="Référence" disabled={locked} className={`${inputCls} h-9 px-2 text-xs`} value={l.physical_reference} onChange={(e) => setRow(i, { physical_reference: e.target.value })} />
              <input aria-label="Désignation" className={`${inputCls} h-9 px-2 text-xs`} value={l.designation} onChange={(e) => setRow(i, { designation: e.target.value })} />
              <input aria-label="Quantité" inputMode="decimal" className={`${inputCls} h-9 px-2 text-xs`} value={l.qty_ordered ?? ""} onChange={(e) => setRow(i, { qty_ordered: numOrNull(e.target.value) })} />
              <PriceInput aria-label="PA HT" className={`${inputCls} h-9 px-2 text-xs`} value={l.expected_unit_cost_ht} onChange={(n) => setRow(i, { expected_unit_cost_ht: n })} />
              {locked ? (
                <span className="flex h-9 items-center justify-center px-2" title="Ligne reçue ou facturée"><Lock className="h-4 w-4" /></span>
              ) : (
                <button type="button" aria-label="Supprimer la ligne" className="flex h-9 items-center justify-center rounded-md border-2 border-border px-2" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
            <input aria-label="OR de la ligne" className={`${inputCls} h-9 px-2 text-xs`} placeholder="OR propre à la ligne (vide = OR de la commande)" value={l.or_text} onChange={(e) => setRow(i, { or_text: e.target.value })} />
            {locked && b ? <p className="text-[11px] text-muted-foreground">Déjà reçu : {b.qty_received}{b.invoiced ? " · facture rapprochée" : ""}. Les pièces reçues restent affectées là où elles ont été réceptionnées.</p> : null}
          </div>
        );
      })}
      <button type="button" className={btnGhost} onClick={() => setRows((rs) => [...rs, { id: null, line_kind: "part", physical_reference: "", designation: "", qty_ordered: 1, expected_unit_cost_ht: null, or_text: "" }])}>+ Ligne</button>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={btnGhost} onClick={onDone}>Annuler</button>
        <button type="button" className={btnPrimary} disabled={busy || inv.isLoading} onClick={save}>Enregistrer</button>
      </div>
    </div>
  );
}
