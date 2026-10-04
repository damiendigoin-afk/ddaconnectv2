import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { btnGhost, btnPrimary, inputCls, numOrNull, PriceInput, usePartsCtx, useSuppliers } from "@/components/parts/PartsUi";
import { findOrByNumber, findOrsByPlate, type OrLite } from "@/lib/parts";
import { formatPlate } from "@/lib/plate";
import { orderDocSignedUrl } from "@/lib/order-docs";
import {
  addProcurementLine, deleteProcurementLine, generateProcurementOrders, getProcurementList, listOpenProcurementLists,
  updateProcurementLine, updateProcurementList, type ProcLine,
} from "@/lib/procurement";
import { confirmText, generationBlocker, generationPlan, ITEM_TYPE_LABEL, LINE_STATUS_LABEL, lineStatus, SOURCE_TYPE_LABEL } from "@/lib/procurement-rules";

/** Listes d'approvisionnement non terminées du site (reprise de l'affectation plus tard). */
export function OpenProcurementLists({ onOpen }: { onOpen: (id: string) => void }) {
  const { readSite } = usePartsCtx();
  const q = useQuery({ queryKey: ["procurement-lists", readSite], queryFn: () => listOpenProcurementLists(readSite) });
  if (!q.data?.length) return null;
  return (
    <section className="space-y-2 pt-2">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Listes d'approvisionnement en cours</h2>
      {q.data.map((l) => (
        <button key={l.id} type="button" onClick={() => onOpen(l.id)} className="card-surface flex w-full items-center justify-between p-3 text-left text-sm">
          <span>
            <b>{l.requested_or_number ? `OR ${l.requested_or_number}` : "OR à renseigner"}</b>
            {l.plate ? ` · ${l.plate}` : ""} · {SOURCE_TYPE_LABEL[l.source_type] ?? l.source_type}{l.source_label ? ` (${l.source_label})` : ""}
          </span>
          <span className="text-xs font-bold uppercase text-muted-foreground">{l.status === "partial" ? "Partielle" : "Brouillon"}</span>
        </button>
      ))}
    </section>
  );
}

export function ProcurementListEditor({ listId, onClose }: { listId: string; onClose: () => void }) {
  const { actor } = usePartsCtx();
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const key = ["procurement-list", listId];
  const q = useQuery({ queryKey: key, queryFn: () => getProcurementList(listId) });
  const [orNum, setOrNum] = useState("");
  const [orInfo, setOrInfo] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<OrLite[]>([]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const list = q.data?.list;
  useEffect(() => { if (list) setOrNum(list.requested_or_number ?? ""); }, [list?.requested_or_number]); // eslint-disable-line react-hooks/exhaustive-deps

  // Immatriculation lue => OR du même site proposés ; un seul => prérempli, plusieurs => choix explicite.
  useEffect(() => {
    if (!list || list.requested_or_number || !list.plate) return;
    void findOrsByPlate(list.plate).then((r) => {
      const same = r.ors.filter((o) => o.site_id === list.site_id);
      if (same.length === 1) void validateOr(same[0]!.or_number ?? "", same[0]!);
      else setCandidates(same);
    });
  }, [list?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isLoading || !q.data || !list) return <p className="card-surface p-3 text-sm">Chargement de la liste…</p>;
  const { lines, orders, doc } = q.data;
  const supplierName = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? "Fournisseur";
  const plan = generationPlan(lines);
  const parts = lines.filter((l) => l.item_type === "part").length;

  async function validateOr(num: string, known?: OrLite) {
    const n = num.trim();
    if (!list) return;
    const or = known ?? (n ? await findOrByNumber(n) : null);
    const ok = or && or.site_id === list.site_id ? or : null;
    await updateProcurementList(list.id, { requested_or_number: n || null, repair_order_id: ok?.id ?? null });
    setOrNum(n);
    setCandidates([]);
    setOrInfo(!n ? null : ok ? `OR ${n} trouvé dans DDA${ok.plate ? ` (${formatPlate(ok.plate)})` : ""}${list.plate && ok.plate && formatPlate(ok.plate) !== formatPlate(list.plate) ? " — immatriculation différente du document, vérifiez" : ""}.` : `OR ${n} non trouvé sur ce site : conservé comme repère, rattachement automatique dès qu'il existera.`);
    void refresh();
  }

  async function openDoc() {
    if (!doc) return;
    const w = window.open("", "_blank");
    const url = await orderDocSignedUrl(doc.storage_path);
    if (!url) { w?.close(); return void toast.error("Document inaccessible."); }
    if (w) w.location.href = url;
  }

  async function generate() {
    if (lock.current || !list) return;
    const block = generationBlocker({ requested_or_number: orNum || list.requested_or_number, status: list.status }, lines);
    if (block) return void toast.error(block);
    if (!window.confirm(confirmText(lines, supplierName))) return;
    lock.current = true;
    setBusy(true);
    try {
      if (orNum.trim() !== (list.requested_or_number ?? "")) await validateOr(orNum);
      const r = await generateProcurementOrders(list.id, actor);
      toast.success(`${r.orders.length} commande${r.orders.length > 1 ? "s" : ""} créée${r.orders.length > 1 ? "s" : ""}${r.remaining ? ` · ${r.remaining} ligne(s) encore à affecter` : ""}.`);
      void qc.invalidateQueries({ queryKey: ["part-orders"] });
      void qc.invalidateQueries({ queryKey: ["procurement-lists"] });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Génération impossible.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="card-surface space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold uppercase">Liste d'approvisionnement</h2>
          <button type="button" className="text-xs font-bold underline" onClick={onClose}>Fermer</button>
        </div>
        <p className="text-sm"><b>Source :</b> {SOURCE_TYPE_LABEL[list.source_type] ?? list.source_type}{list.extraction_route === "ai_vision_fallback" ? " (lecture IA)" : ""}</p>
        {list.source_label ? <p className="text-sm"><b>Émetteur du document :</b> {list.source_label} <span className="text-xs text-muted-foreground">(information — ce n'est pas un fournisseur)</span></p> : null}
        {doc ? <button type="button" onClick={() => void openDoc()} className="inline-flex items-center gap-1 rounded-md border-2 border-border px-2 py-1 text-xs font-bold"><FileText className="h-3.5 w-3.5" /> Document source</button> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-bold uppercase">N° OR / dossier WinMotor *
            <input className={inputCls} value={orNum} inputMode="numeric" placeholder="Obligatoire avant génération" onChange={(e) => setOrNum(e.target.value)} onBlur={() => { if (orNum.trim() !== (list.requested_or_number ?? "")) void validateOr(orNum); }} />
          </label>
          <label className="text-xs font-bold uppercase">Immatriculation
            <input className={inputCls} defaultValue={list.plate ?? ""} onBlur={(e) => { const p = e.target.value.trim() ? formatPlate(e.target.value) : null; if (p !== list.plate) void updateProcurementList(list.id, { plate: p }).then(refresh); }} />
          </label>
        </div>
        {orInfo ? <p className="text-xs">{orInfo}</p> : !list.requested_or_number ? <p className="text-xs font-bold text-destructive">OR non identifié sur le document : renseignez-le.</p> : list.repair_order_id ? <p className="text-xs">OR rattaché dans DDA.</p> : null}
        {candidates.length > 1 ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <span>Plusieurs OR pour cette immatriculation :</span>
            {candidates.map((c) => <button key={c.id} type="button" className="rounded border-2 border-border px-2 font-bold" onClick={() => void validateOr(c.or_number ?? "", c)}>OR {c.or_number}</button>)}
          </div>
        ) : null}
        {Array.isArray(list.warnings) && list.warnings.length ? <p className="text-xs text-muted-foreground">{(list.warnings as string[]).join(" ")}</p> : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-bold uppercase text-muted-foreground">{parts} pièce{parts > 1 ? "s" : ""} de rechange · {lines.length} ligne{lines.length > 1 ? "s" : ""}</h3>
        {lines.map((l) => <LineCard key={l.id} l={l} suppliers={(suppliers.data ?? []).filter((s) => s.active !== false || s.id === l.supplier_id)} onChange={refresh} />)}
        <button type="button" className={`${btnGhost} flex w-full items-center justify-center gap-2`} onClick={() => void addProcurementLine(list.id, lines.length).then(refresh)}>
          <Plus className="h-4 w-4" /> Ajouter une ligne
        </button>
      </section>

      <section className="card-surface space-y-2 p-3">
        <p className="text-xs">{[...plan.groups].map(([id, ls]) => `${ls.length} → ${supplierName(id)}`).join(" · ") || "Aucune ligne prête"}{plan.unassigned ? ` · ${plan.unassigned} à affecter` : ""}{plan.alreadyOrdered ? ` · ${plan.alreadyOrdered} déjà commandée(s)` : ""}</p>
        <button type="button" className={`${btnPrimary} w-full`} disabled={busy || !plan.groups.size} onClick={() => void generate()}>
          {busy ? "Génération…" : "Générer les commandes"}
        </button>
        {orders.length ? (
          <div className="space-y-1 text-sm">
            <p className="text-xs font-bold uppercase text-muted-foreground">Commandes générées</p>
            {orders.map((o) => (
              <Link key={o.id} to="/pieces-achats/commande/$orderId" params={{ orderId: o.id }} className="block underline">
                {(o.suppliers as { name?: string } | null)?.name ?? "Fournisseur"} — {new Date(o.created_at).toLocaleDateString("fr-FR")}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LineCard({ l, suppliers, onChange }: { l: ProcLine; suppliers: { id: string; name: string }[]; onChange: () => void }) {
  const frozen = !!l.generated_order_id;
  const save = (patch: Parameters<typeof updateProcurementLine>[1]) =>
    updateProcurementLine(l.id, patch).then(onChange).catch((e: Error) => toast.error(e.message));
  const status = lineStatus(l);
  return (
    <div className={`card-surface space-y-2 p-3 ${frozen ? "opacity-80" : ""}`}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-bold uppercase">{ITEM_TYPE_LABEL[l.item_type]}{l.source_operation ? ` · op ${l.source_operation}` : ""}</span>
        <span className={`rounded px-2 py-0.5 font-bold uppercase ${status === "to_assign" ? "bg-muted" : "bg-brand/15"}`}>{LINE_STATUS_LABEL[status]}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[120px_1fr_70px_110px]">
        <select className={inputCls} disabled={frozen} defaultValue={l.item_type} aria-label="Type" onChange={(e) => void save({ item_type: e.target.value as ProcLine["item_type"] })}>
          {Object.entries(ITEM_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className={inputCls} disabled={frozen} defaultValue={l.designation} aria-label="Désignation" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.designation) void save({ designation: v }); }} />
        <input className={inputCls} disabled={frozen} defaultValue={String(l.quantity)} inputMode="decimal" aria-label="Quantité" onBlur={(e) => { const v = numOrNull(e.target.value); if (v && v > 0 && v !== Number(l.quantity)) void save({ quantity: v }); }} />
        <input className={inputCls} disabled={frozen} defaultValue={l.reference ?? ""} placeholder="Réf. (facult.)" aria-label="Référence" onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== l.reference) void save({ reference: v }); }} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto]">
        <PriceInput className={inputCls} value={l.source_price_ht} aria-label="Prix source HT" placeholder="Prix source HT" onChange={(v) => { if (!frozen && v !== l.source_price_ht) void save({ source_price_ht: v }); }} />
        <select className={inputCls} disabled={frozen} value={l.supplier_id ?? ""} aria-label="Fournisseur" onChange={(e) => void save({ supplier_id: e.target.value || null })}>
          <option value="">— À affecter —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {frozen ? null : (
          <button type="button" className={btnGhost} aria-label="Supprimer la ligne" onClick={() => { if (window.confirm("Supprimer cette ligne ?")) void deleteProcurementLine(l.id).then(onChange); }}>
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Prix source = tarif / prix de vente indicatif du document, jamais le prix d'achat.</p>
    </div>
  );
}
