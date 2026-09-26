import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Badge, btnGhost, btnPrimary, inputCls, numOrNull, SiteFilter, usePartsCtx } from "@/components/parts/PartsUi";
import { supabase } from "@/integrations/supabase/client";
import { adjustStock, findStockByRef } from "@/lib/parts";
import { sessionMinutes } from "@/lib/parts-rules";
import { formatHours, lineTotals } from "@/lib/winmotor/invoices";
import { billingAnomalies, canLink, lineRemaining, proposeMatches, usageRemaining, type DdaUsage, type Link as RLink, type WmLine } from "@/lib/winmotor/reconcile";
import { linkUsage, listBilledOrs, loadEquivalences, orBillingBundle, rememberEquivalence, storeSale, unlink } from "@/lib/winmotor/wm-data";

export const Route = createFileRoute("/pieces-achats/controle-winmotor")({
  validateSearch: (s: Record<string, unknown>): { site?: string; or?: string } => ({
    ...(typeof s["site"] === "string" ? { site: s["site"] } : {}),
    ...(typeof s["or"] === "string" || typeof s["or"] === "number" ? { or: String(s["or"]) } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Contrôle WinMotor — DDA Connect" },
      { name: "description", content: "Rapprochement factures WinMotor et réalité atelier DDA, OR par OR." },
      { property: "og:title", content: "Contrôle WinMotor — DDA Connect" },
      { property: "og:description", content: "Rapprochement facturation WinMotor / atelier DDA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ControlPage,
});

function ControlPage() {
  const s = Route.useSearch();
  return (
    <AppShell title="Contrôle WinMotor" subtitle="Pièces & achats" back={{ to: "/pieces-achats" }}>
      {s.site && s.or ? <OrControl siteId={s.site} orNumber={s.or} /> : <OrList />}
    </AppShell>
  );
}

function OrList() {
  const { siteName } = usePartsCtx();
  const [scope, setScope] = useState("groupe");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const list = useQuery({ queryKey: ["wm-ors", scope, q, page], queryFn: () => listBilledOrs(scope === "groupe" ? null : scope, page, q) });
  return (
    <div className="space-y-3">
      <input className={inputCls} placeholder="N° OR, n° facture ou immatriculation exacte" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
      <SiteFilter value={scope} onChange={(v) => { setScope(v); setPage(0); }} />
      {list.data && !list.data.length ? <p className="card-surface p-4 text-sm text-muted-foreground">Aucune facture WinMotor importée. Importez les exports depuis Paramétrage › Imports WinMotor.</p> : null}
      {(list.data ?? []).map((g) => (
        <Link key={`${g.site_id}|${g.or_number}`} to="/pieces-achats/controle-winmotor" search={{ site: g.site_id, or: g.or_number }} className="block rounded-xl border-2 border-border bg-card p-3 text-sm">
          <div className="flex justify-between"><b>OR {g.or_number}</b><span className="text-xs">{g.last ? new Date(g.last).toLocaleDateString("fr-FR") : ""}</span></div>
          <div className="text-xs text-muted-foreground">{siteName(g.site_id)} · {g.plate ?? "—"} · {g.invoices.length} facture(s) · {g.ttc.toFixed(2)} € TTC{g.repair_order_id ? "" : " · pas de dossier DDA"}</div>
        </Link>
      ))}
      <div className="flex justify-between text-xs">
        <button className="underline disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Plus récents</button>
        <button className="underline disabled:opacity-40" disabled={(list.data?.length ?? 0) === 0} onClick={() => setPage((p) => p + 1)}>Plus anciens</button>
      </div>
    </div>
  );
}

function OrControl({ siteId, orNumber }: { siteId: string; orNumber: string }) {
  const { actor, siteName } = usePartsCtx();
  const qc = useQueryClient();
  const b = useQuery({ queryKey: ["wm-or", siteId, orNumber], queryFn: () => orBillingBundle(siteId, orNumber) });
  const eqQ = useQuery({ queryKey: ["wm-eq"], queryFn: loadEquivalences });
  const [selLine, setSelLine] = useState<string | null>(null);
  const [selUsage, setSelUsage] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["wm-or", siteId, orNumber] }); qc.invalidateQueries({ queryKey: ["regul"] }); };

  const data = b.data;
  const eq = eqQ.data ?? new Map();
  const docByInv = new Map((data?.invoices ?? []).map((i) => [i.id, i.doc_kind]));
  const lines: WmLine[] = (data?.lines ?? []).map((l) => ({ id: l.id, invoice_id: l.invoice_id, line_kind: l.line_kind, reference_normalized: l.reference_normalized, designation: l.designation, qty: l.qty == null ? null : Number(l.qty), doc_kind: docByInv.get(l.invoice_id) ?? "invoice" }));
  const usages: DdaUsage[] = (data?.usages ?? []).map((u) => ({ id: u.id, item_kind: u.item_kind, physical_reference: u.physical_reference, qty_allocated: Number(u.qty_allocated), qty_used: u.qty_used == null ? null : Number(u.qty_used), usage_status: u.usage_status, article_id: u.article_id }));
  const links: RLink[] = (data?.links ?? []).map((k) => ({ invoice_line_id: k.invoice_line_id, usage_id: k.usage_id, qty: Number(k.qty), status: k.status }));
  const totals = lineTotals((data?.lines ?? []).map((l) => ({ ...l, qty: l.qty == null ? null : Number(l.qty), net_ht: l.net_ht == null ? null : Number(l.net_ht) })));
  const minutes = (data?.sessions ?? []).reduce((s, x) => s + sessionMinutes(x), 0);
  const proposals = useMemo(() => proposeMatches(lines, usages, links, eq), [data, eq]); // eslint-disable-line react-hooks/exhaustive-deps
  const anomalies = useMemo(() => billingAnomalies({ lines, usages, links, eq, hoursBilled: totals.hours, minutesDda: minutes }), [data, eq]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doLink(lineId: string, usageId: string, q: number, method: "auto" | "manual", rule: string | null) {
    const line = lines.find((l) => l.id === lineId)!;
    const u = usages.find((x) => x.id === usageId)!;
    const err = canLink(line, u, q, links);
    if (err) return void toast.error(err);
    try {
      await linkUsage(lineId, usageId, q, method, rule, actor.name);
      if (method === "manual" && line.reference_normalized && u.physical_reference) await rememberEquivalence(line.reference_normalized, u.physical_reference, actor.name);
      toast.success("Rapprochement enregistré — sortie définitive du stock faite une seule fois");
      setSelLine(null); setSelUsage(null); refresh(); qc.invalidateQueries({ queryKey: ["wm-eq"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  }
  async function applyAllSure() {
    for (const p of proposals.sure) await doLink(p.lineId, p.usageId, p.qty, "auto", p.rule);
  }
  async function regul(kind: string, sourceId: string, ref: string | null, closed: boolean) {
    const comment = window.prompt(closed ? "Justification (inclus forfait, facturé ailleurs, non refacturé, erreur, autre…) :" : "Commentaire pour À régulariser :");
    if (comment === null) return;
    await supabase.from("parts_regularizations").insert({ site_id: siteId, kind, source_id: sourceId === "time" ? null : sourceId, repair_order_id: data?.orId ?? null, physical_reference: ref, comment: `OR ${orNumber} — ${comment}`, status: closed ? "closed" : "open", created_by_name: actor.name, ...(closed ? { closed_at: new Date().toISOString(), closed_by: actor.userId, closed_by_name: actor.name, closing_comment: comment } : {}) });
    toast.success(closed ? "Justification enregistrée" : "Envoyé à À régulariser");
    refresh();
  }
  async function reintegrate(lineId: string, ref: string | null) {
    if (!ref) return;
    const hits = await findStockByRef(siteId, ref);
    if (hits.length !== 1) return void toast.error(hits.length ? "Plusieurs fiches stock : réintégrez depuis la page Stock." : "Aucune fiche stock pour cette référence sur ce site.");
    const n = numOrNull(window.prompt("Quantité physiquement revenue et remise en stock :") ?? "");
    if (!n) return;
    const why = window.prompt("Motif :") ?? "";
    if (!why.trim()) return void toast.error("Motif obligatoire");
    await adjustStock(hits[0]!.id, siteId, n, `Réintégration après avoir client (OR ${orNumber}) — ${why}`, actor);
    await supabase.from("parts_regularizations").insert({ site_id: siteId, kind: "avoir_client", source_id: lineId, repair_order_id: data?.orId ?? null, physical_reference: ref, comment: `Réintégré ${n} — ${why}`, status: "closed", closed_at: new Date().toISOString(), closed_by: actor.userId, closed_by_name: actor.name, closing_comment: "Réintégré au stock", created_by_name: actor.name });
    toast.success("Réintégration enregistrée"); refresh();
  }
  async function cancelLink(id: string) {
    if (!window.confirm("Annuler ce rapprochement ? La pièce redevient « affectée OR » (pas de retour stock automatique).")) return;
    await unlink(id, actor.name); refresh();
  }

  if (!data) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  const activeLinks = (data.links ?? []).filter((k) => k.status === "active");
  const staleLinks = (data.links ?? []).filter((k) => k.status === "stale");
  return (
    <div className="space-y-3">
      <div className="card-surface space-y-1 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-lg">OR {orNumber}</b><Badge tone="brand">{siteName(siteId)}</Badge>
          {data.orId ? <Link to="/or/$orId" params={{ orId: data.orId }} className="underline">Dossier OR</Link> : <Badge>Pas de dossier DDA</Badge>}
          <Link to="/pieces-achats/controle-winmotor" className="text-xs underline">← liste</Link>
        </div>
        <div className="text-xs">{data.invoices.length} facture(s) cumulée(s) · Lignes HT {totals.ht.toFixed(2)} € · MO facturée {formatHours(totals.hours)} · Temps DDA {formatHours(minutes / 60)} (information)</div>
      </div>

      {anomalies.filter((a) => a.level !== "info").length ? (
        <section className="card-surface space-y-2 p-3">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">Anomalies</h2>
          {anomalies.filter((a) => a.level !== "info").map((a) => (
            <div key={a.kind + a.sourceId} className={`rounded-lg border-2 p-2 text-xs ${a.level === "strong" ? "border-destructive bg-destructive/10" : "border-status-watch bg-status-watch-soft"}`}>
              <b>{a.label}</b>{a.ref ? ` · ${a.ref}` : ""}
              <div className="mt-1 flex flex-wrap gap-3">
                {a.kind === "avoir_client" ? (
                  <>
                    <button className="underline" onClick={() => reintegrate(a.sourceId, a.ref)}>Réintégrer au stock</button>
                    <button className="underline" onClick={() => regul("avoir_client", a.sourceId, a.ref, true)}>Ne pas réintégrer</button>
                  </>
                ) : <button className="underline" onClick={() => regul(a.kind, a.sourceId, a.ref, true)}>Justifier</button>}
                <button className="underline" onClick={() => regul(a.kind, a.sourceId, a.ref, false)}>À régulariser</button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {staleLinks.length ? <Badge tone="warn">{staleLinks.length} rapprochement(s) à revoir : facture modifiée dans un export plus récent</Badge> : null}

      {proposals.sure.length ? (
        <section className="card-surface space-y-2 p-3">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">Correspondances sûres proposées</h2>
          {proposals.sure.map((p) => {
            const l = lines.find((x) => x.id === p.lineId)!;
            return <div key={p.lineId} className="text-xs">{l.reference_normalized} × {p.qty} · {p.rule === "exact" ? "référence exacte" : "équivalence apprise"}</div>;
          })}
          <button className={`${btnPrimary} w-full`} onClick={applyAllSure}>Appliquer ({proposals.sure.length})</button>
          {proposals.ambiguous.length ? <p className="text-xs text-muted-foreground">{proposals.ambiguous.length} ligne(s) avec plusieurs candidats : à lier manuellement.</p> : null}
        </section>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <section className="card-surface space-y-2 p-3">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">WinMotor</h2>
          {data.invoices.map((inv) => (
            <div key={inv.id} className="space-y-1">
              <Link to="/facture/$invoiceId" params={{ invoiceId: inv.id }} className="text-xs font-extrabold underline">
                {inv.doc_kind === "credit" ? "Avoir" : inv.doc_kind === "preinvoice" ? "Préfacture" : "Facture"} {inv.invoice_number} · {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("fr-FR") : ""}
              </Link>
              {lines.filter((l) => l.invoice_id === inv.id).map((l) => {
                const full = data.lines.find((x) => x.id === l.id)!;
                const left = lineRemaining(l, links);
                const selectable = (l.line_kind === "part" || l.line_kind === "package_part") && Number(l.qty ?? 0) > 0 && left > 0;
                return (
                  <button key={l.id} disabled={!selectable} onClick={() => { setSelLine(l.id); setQty(String(left)); }} className={`block w-full rounded-lg border-2 p-2 text-left text-xs ${selLine === l.id ? "border-brand bg-brand/10" : "border-border"} ${l.line_kind === "package_header" ? "font-extrabold" : ""}`}>
                    <div className="flex justify-between gap-2"><span className="truncate">{full.reference ?? ""} {full.designation}</span><span>{full.qty}{l.line_kind.includes("labour") ? " h" : ""}</span></div>
                    <div className="text-muted-foreground">{full.net_ht != null && l.line_kind !== "package_header" ? `${Number(full.net_ht).toFixed(2)} € HT` : "titre"}{full.vat_rate != null ? ` · TVA ${full.vat_rate} %` : ""}{selectable ? ` · reste ${left}` : Number(l.qty ?? 0) > 0 && (l.line_kind === "part" || l.line_kind === "package_part") ? " · rapprochée" : ""}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </section>
        <section className="card-surface space-y-2 p-3">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">DDA</h2>
          {!data.orId ? <p className="text-xs text-muted-foreground">Aucun dossier atelier DDA pour cet OR.</p> : null}
          {data.orders.map((o) => <div key={o.id} className="text-xs">Commande {(o.suppliers as { name: string } | null)?.name} · {o.status}</div>)}
          {usages.map((u) => {
            const full = data.usages.find((x) => x.id === u.id)!;
            const left = usageRemaining(u, links);
            return (
              <button key={u.id} disabled={left <= 0} onClick={() => setSelUsage(u.id)} className={`block w-full rounded-lg border-2 p-2 text-left text-xs ${selUsage === u.id ? "border-brand bg-brand/10" : "border-border"}`}>
                <div className="flex justify-between gap-2"><span className="truncate">{u.physical_reference ?? ""} {full.designation}</span><Badge tone={u.usage_status === "used" ? "ok" : u.usage_status === "pending" ? "warn" : "muted"}>{u.usage_status === "used" ? "Montée" : u.usage_status === "pending" ? "À pointer" : u.usage_status === "partial" ? "Partielle" : "Non utilisée"}</Badge></div>
                <div className="text-muted-foreground">Affectée {u.qty_allocated}{u.qty_used != null ? ` · utilisée ${u.qty_used}` : ""} · reste à rapprocher {left}{u.item_kind === "consumable" ? " · consommable" : ""}</div>
              </button>
            );
          })}
        </section>
      </div>

      {selLine && selUsage ? (
        <div className="sticky bottom-20 z-20 flex gap-2 rounded-xl border-2 border-brand bg-card p-2">
          <input className={`${inputCls} w-24`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Quantité" />
          <button className={`${btnPrimary} flex-1`} onClick={() => doLink(selLine, selUsage, numOrNull(qty) ?? 0, "manual", null)}>Lier</button>
          <button className={btnGhost} onClick={() => { setSelLine(null); setSelUsage(null); }}>×</button>
        </div>
      ) : null}

      {activeLinks.length ? (
        <section className="card-surface space-y-1 p-3">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">Rapprochements</h2>
          {activeLinks.map((k) => {
            const l = data.lines.find((x) => x.id === k.invoice_line_id);
            return (
              <div key={k.id} className="flex justify-between gap-2 text-xs">
                <span>{l?.reference ?? l?.designation} × {k.qty} · {k.method === "auto" ? "auto" : "manuel"}{k.rule ? ` (${k.rule})` : ""} · {k.created_by_name}{k.sale_movement_id ? " · sortie stock faite" : ""}</span>
                <button className="underline" onClick={() => cancelLink(k.id)}>Annuler</button>
              </div>
            );
          })}
        </section>
      ) : null}
      <StoreSaleHint siteId={siteId} lines={data.lines.filter((l) => !data.orId && (l.line_kind === "part" || l.line_kind === "package_part") && Number(l.qty ?? 0) > 0)} links={links} onDone={refresh} />
    </div>
  );
}

/** Facture sans dossier atelier : sortie « vente magasin » seulement si un humain la confirme et que le candidat stock est unique. */
function StoreSaleHint({ siteId, lines, links, onDone }: { siteId: string; lines: { id: string; invoice_id: string; line_kind: string; reference: string | null; reference_normalized: string | null; designation: string | null; qty: number | null }[]; links: RLink[]; onDone: () => void }) {
  const { actor } = usePartsCtx();
  if (!lines.length) return null;
  async function sale(l: (typeof lines)[number]) {
    if (!l.reference) return;
    const hits = (await findStockByRef(siteId, l.reference)).filter((h) => h.available_qty > 0);
    if (hits.length !== 1) return void toast.error(hits.length ? "Plusieurs fiches stock possibles : à traiter manuellement." : "Aucun stock disponible pour cette référence : rien n'est sorti.");
    const left = lineRemaining({ ...l, qty: l.qty == null ? null : Number(l.qty) }, links);
    const n = numOrNull(window.prompt(`Vente magasin : quantité réellement sortie du stock (max ${left}) :`, String(left)) ?? "");
    if (!n) return;
    try { await storeSale(l.id, hits[0]!.id, n, actor.name); toast.success("Vente magasin enregistrée"); onDone(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  }
  return (
    <section className="card-surface space-y-1 p-3">
      <h2 className="text-xs font-bold uppercase text-muted-foreground">Vente magasin ?</h2>
      <p className="text-xs text-muted-foreground">Aucun dossier atelier : si ces pièces ont été vendues au comptoir, confirmez la sortie. La facture seule ne sort rien du stock.</p>
      {lines.map((l) => <button key={l.id} className="block text-xs underline" onClick={() => sale(l)}>{l.reference ?? l.designation} × {l.qty} — sortir du stock</button>)}
    </section>
  );
}
