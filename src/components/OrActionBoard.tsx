import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Hourglass, Play, Square } from "lucide-react";
import { toast } from "sonner";

import { Badge, btnGhost, btnPrimary, inputCls, numOrNull, usePartsCtx } from "@/components/parts/PartsUi";
import { addUnplannedUsage, confirmUsage, finishWork, getWorkState, listSessions, listUsage, myOpenSessions, orPartsOverview, returnUnusedToStock, startTime, stopTime } from "@/lib/parts";
import { finishCheck, formatMinutes, partsCompleteness, sessionMinutes, USAGE_REASONS } from "@/lib/parts-rules";

/**
 * Tableau d'actions terrain du dossier OR (V3 Phase B).
 * Sans OR WinMotor officiel : aucun pointage ni « Travaux terminés ». « Arrêter » ≠ « Travaux terminés ».
 */
export function OrActionBoard({ hasOfficialOr, orId, orSiteId }: { hasOfficialOr: boolean; orId: string; orSiteId: string | null }) {
  if (!hasOfficialOr) {
    return (
      <section className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Actions atelier</h2>
        <div className="rounded-xl border-2 border-status-watch bg-status-watch-soft px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-extrabold uppercase"><Hourglass className="h-4 w-4" /> Dossier DDA — en attente OR WinMotor</div>
          <p className="text-xs text-muted-foreground">Temps, pièces et « Travaux terminés » disponibles uniquement une fois l'OR créé dans WinMotor et rattaché. Le Tour véhicule et l'Expertise restent possibles.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Actions atelier</h2>
      <WorkStateBanner orId={orId} />
      <TimePanel orId={orId} orSiteId={orSiteId} />
      <PartsStatus orId={orId} />
      <UsagePanel orId={orId} orSiteId={orSiteId} />
      <FinishPanel orId={orId} orSiteId={orSiteId} />
    </section>
  );
}

function useWorkState(orId: string) {
  return useQuery({ queryKey: ["or-state", orId], queryFn: () => getWorkState(orId) });
}

function WorkStateBanner({ orId }: { orId: string }) {
  const s = useWorkState(orId).data;
  if (!s) return <Badge>Travaux en cours</Badge>;
  if (s.state === "travaux_termines") return <div className="rounded-xl border-2 border-status-ok bg-status-ok-soft p-3 text-sm font-extrabold uppercase">Travaux terminés · {s.finished_by_name} · {s.finished_at ? new Date(s.finished_at).toLocaleString("fr-FR") : ""}{s.forced ? " · forcé" : ""}</div>;
  if (s.state === "a_revalider") return <div className="rounded-xl border-2 border-status-watch bg-status-watch-soft p-3 text-sm font-extrabold uppercase">À revalider — modifié après « Travaux terminés »</div>;
  return <Badge>Travaux en cours</Badge>;
}

function TimePanel({ orId, orSiteId }: { orId: string; orSiteId: string | null }) {
  const { actor } = usePartsCtx();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["or-time", orId], queryFn: () => listSessions(orId), refetchInterval: 60000 });
  const mine = useQuery({ queryKey: ["my-open-time", actor.userId], enabled: !!actor.userId, queryFn: () => myOpenSessions(actor.userId!) });
  const myOpenHere = (sessions.data ?? []).find((s) => s.user_id === actor.userId && !s.stopped_at);
  const elsewhere = (mine.data ?? []).filter((s) => s.repair_order_id !== orId);
  const total = (sessions.data ?? []).reduce((t, s) => t + sessionMinutes(s), 0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["or-time", orId] }); qc.invalidateQueries({ queryKey: ["my-open-time"] }); qc.invalidateQueries({ queryKey: ["or-state", orId] }); };

  async function start() {
    try { await startTime(orId, orSiteId, actor); toast.success("Temps démarré"); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); }
  }
  async function stop() {
    if (!myOpenHere) return;
    await stopTime(myOpenHere.id, orId, orSiteId, actor); toast.success("Temps arrêté (les travaux ne sont pas clôturés)"); refresh();
  }
  return (
    <div className="card-surface space-y-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase text-muted-foreground">Temps passé</span>
        <span className="text-lg font-extrabold">{formatMinutes(total)}</span>
      </div>
      {elsewhere.length ? <p className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3 w-3" /> Temps déjà ouvert sur l'OR {elsewhere.map((s) => (s.repair_orders as { or_number: string | null } | null)?.or_number ?? "?").join(", ")}</p> : null}
      {myOpenHere ? (
        <button className={`${btnPrimary} w-full`} onClick={stop}><Square className="mr-1 inline h-4 w-4" /> Arrêter le temps · {formatMinutes(sessionMinutes(myOpenHere))}</button>
      ) : (
        <button className={`${btnPrimary} w-full`} onClick={start}><Play className="mr-1 inline h-4 w-4" /> Démarrer le temps</button>
      )}
      {(sessions.data ?? []).slice(0, 6).map((s) => (
        <div key={s.id} className="text-xs text-muted-foreground">{s.user_name} · {new Date(s.started_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} → {s.stopped_at ? new Date(s.stopped_at).toLocaleTimeString("fr-FR", { timeStyle: "short" }) : "en cours"} · {formatMinutes(sessionMinutes(s))}</div>
      ))}
    </div>
  );
}

function PartsStatus({ orId }: { orId: string }) {
  const ov = useQuery({ queryKey: ["or-parts", orId], queryFn: () => orPartsOverview(orId) });
  const usage = useQuery({ queryKey: ["or-usage", orId], queryFn: () => listUsage(orId) });
  if (!ov.data) return null;
  const lines = ov.data.orders.filter((o) => o.status !== "cancelled").flatMap((o) => (o.part_order_lines ?? []).filter((l) => l.line_kind === "part"));
  const simplified = ov.data.orders.filter((o) => o.status !== "cancelled" && !(o.part_order_lines ?? []).length).length;
  const c = partsCompleteness({ simplifiedWithoutLines: simplified, lines });
  const used = (usage.data ?? []).filter((u) => u.usage_status === "used").length;
  return (
    <div className="card-surface space-y-2 p-3">
      <span className="text-xs font-bold uppercase text-muted-foreground">Statut des pièces</span>
      {c.kind === "none" ? <p className="text-sm text-muted-foreground">Aucune commande pour cet OR.</p> : c.kind === "unknown" ? (
        <div className="rounded-lg border-2 border-status-watch bg-status-watch-soft p-2 text-sm font-extrabold uppercase">Commande non détaillée — complétude inconnue</div>
      ) : (
        <div className={`rounded-lg border-2 p-2 text-lg font-extrabold uppercase ${c.kind === "complete" ? "border-status-ok bg-status-ok-soft" : "border-destructive bg-destructive/10"}`}>
          Pièces {c.kind === "complete" ? "complètes" : "incomplètes"} {c.done}/{c.total}
        </div>
      )}
      {ov.data.orders.map((o) => (
        <Link key={o.id} to="/pieces-achats/commande/$orderId" params={{ orderId: o.id }} className="block text-xs underline">
          Commande {(o.suppliers as { name: string } | null)?.name} · {o.status === "received" ? "reçue" : o.status === "partial" ? "partiellement reçue — reliquat" : "commandée"}
        </Link>
      ))}
      {lines.map((l) => <div key={l.id} className="text-xs">{l.physical_reference ?? l.designation} · reçue {l.qty_received}/{l.qty_ordered ?? "?"}</div>)}
      {(usage.data ?? []).length ? <p className="text-xs">Au garage / affectées : {(usage.data ?? []).filter((u) => u.qty_allocated > 0).length} · Montées / utilisées : {used}</p> : null}
    </div>
  );
}

function UsagePanel({ orId, orSiteId }: { orId: string; orSiteId: string | null }) {
  const { actor, writeSite } = usePartsCtx();
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ["or-usage", orId], queryFn: () => listUsage(orId) });
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"part" | "oil" | "consumable">("part");
  const [ref, setRef] = useState("");
  const [des, setDes] = useState("");
  const [qty, setQty] = useState("1");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["or-usage", orId] }); qc.invalidateQueries({ queryKey: ["or-state", orId] }); };
  const site = orSiteId ?? writeSite;

  async function mark(u: { id: string; qty_allocated: number }, status: "used" | "not_used") {
    let reason: string | null = null;
    let comment: string | null = null;
    if (status === "not_used") {
      reason = window.prompt(`Motif (encouragé) : ${USAGE_REASONS.join(" / ")}`) || null;
      if (reason === "Autre") comment = window.prompt("Commentaire :") || null;
    }
    await confirmUsage({ id: u.id, orId, siteId: site, status, qty_used: status === "used" ? u.qty_allocated : 0, reason, comment }, actor);
    refresh();
  }
  async function partial(u: { id: string; qty_allocated: number }) {
    const n = numOrNull(window.prompt(`Quantité réellement utilisée (sur ${u.qty_allocated}) :`) ?? "");
    if (n == null) return;
    const reason = window.prompt("Motif pour le reste (encouragé) :") || null;
    await confirmUsage({ id: u.id, orId, siteId: site, status: "partial", qty_used: n, reason, comment: `${u.qty_allocated - n} à traiter` }, actor);
    refresh();
  }
  async function add() {
    if (!site) return void toast.error("Aucun site pour cet OR.");
    const n = numOrNull(qty);
    if (!n || (!ref.trim() && !des.trim())) return void toast.error("Référence ou désignation + quantité");
    await addUnplannedUsage({ orId, siteId: site, kind, ref, designation: des, qty: n }, actor);
    setRef(""); setDes(""); setQty("1"); setAdding(false); refresh(); toast.success("Utilisation ajoutée");
  }

  return (
    <div className="card-surface space-y-2 p-3">
      <span className="text-xs font-bold uppercase text-muted-foreground">Pointer pièces / consommables</span>
      {!(usage.data ?? []).length ? <p className="text-sm text-muted-foreground">Aucune pièce affectée à cet OR.</p> : null}
      {(usage.data ?? []).map((u) => (
        <div key={u.id} className="rounded-lg border-2 border-border p-2 text-sm">
          <div className="flex justify-between gap-2">
            <b>{u.physical_reference ?? u.designation}</b>
            <Badge tone={u.usage_status === "used" ? "ok" : u.usage_status === "pending" ? "warn" : "muted"}>
              {u.usage_status === "used" ? "Utilisée" : u.usage_status === "not_used" ? "Non utilisée" : u.usage_status === "partial" ? "Partielle" : "À pointer"}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">{u.designation} · affectée {u.qty_allocated}{u.qty_used != null ? ` · utilisée ${u.qty_used}` : ""}{u.unplanned ? " · ajout non prévu" : ""}{u.reason ? ` · ${u.reason}` : ""}{u.confirmed_by_name ? ` · ${u.confirmed_by_name}` : ""}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="rounded-lg border-2 border-status-ok px-3 py-1 text-xs font-bold" onClick={() => mark(u, "used")}>Utilisée</button>
            <button className="rounded-lg border-2 border-border px-3 py-1 text-xs font-bold" onClick={() => partial(u)}>Partielle</button>
            <button className="rounded-lg border-2 border-border px-3 py-1 text-xs font-bold" onClick={() => mark(u, "not_used")}>Non utilisée</button>
            {u.article_id && site && u.usage_status !== "used" && u.qty_allocated > (u.qty_used ?? 0) ? (
              <button className="text-xs underline" onClick={async () => { await returnUnusedToStock({ id: u.id, orId, siteId: u.site_id ?? site, articleId: u.article_id!, qty: u.qty_allocated - (u.qty_used ?? 0) }, actor); refresh(); toast.success("Remise en stock"); }}>Remettre en stock</button>
            ) : null}
          </div>
        </div>
      ))}
      {adding ? (
        <div className="space-y-2">
          <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="part">Pièce</option><option value="oil">Huile (litres)</option><option value="consumable">Petite fourniture</option>
          </select>
          <input className={inputCls} placeholder="Référence" value={ref} onChange={(e) => setRef(e.target.value)} />
          <input className={inputCls} placeholder="Désignation" value={des} onChange={(e) => setDes(e.target.value)} />
          <input className={inputCls} inputMode="decimal" placeholder="Quantité" value={qty} onChange={(e) => setQty(e.target.value)} />
          <div className="grid grid-cols-2 gap-2"><button className={btnGhost} onClick={() => setAdding(false)}>Annuler</button><button className={btnPrimary} onClick={add}>Ajouter</button></div>
        </div>
      ) : <button className={`${btnGhost} w-full`} onClick={() => setAdding(true)}>+ Ajouter une utilisation réelle</button>}
    </div>
  );
}

function FinishPanel({ orId, orSiteId }: { orId: string; orSiteId: string | null }) {
  const { actor, writeSite } = usePartsCtx();
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: ["or-usage", orId], queryFn: () => listUsage(orId) });
  const state = useWorkState(orId).data;
  const site = orSiteId ?? writeSite;
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const chk = finishCheck(usage.data ?? []);

  async function finish(forced: boolean) {
    if (!site) return void toast.error("Aucun site pour cet OR.");
    await finishWork(orId, site, { forced, reason: reason.trim() || null, pending: chk.pending }, actor);
    setConfirm(false); setReason("");
    qc.invalidateQueries({ queryKey: ["or-state", orId] });
    toast.success(forced ? "Travaux terminés (anomalie créée)" : "Travaux terminés");
  }
  if (state?.state === "travaux_termines") return null;
  return (
    <div className="card-surface space-y-2 p-3">
      {confirm ? (
        <>
          <p className="text-sm font-bold text-destructive">{chk.pending} ligne(s) pièces non traitée(s).</p>
          <input className={inputCls} placeholder="Justification (encouragée)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button className={btnGhost} onClick={() => setConfirm(false)}>Revenir pointer</button>
            <button className={btnPrimary} onClick={() => finish(true)}>Terminer malgré tout</button>
          </div>
        </>
      ) : (
        <button className={`${btnPrimary} w-full`} onClick={() => (chk.canFinishCleanly ? finish(false) : setConfirm(true))}>
          <CheckCircle2 className="mr-1 inline h-4 w-4" /> Travaux terminés
        </button>
      )}
    </div>
  );
}
