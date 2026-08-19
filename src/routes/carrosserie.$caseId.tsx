import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Camera, Check, Loader2, Plus, Send, Upload } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { Area, Badge, Field, Section, Select } from "@/components/bits";
import { ExpertContact } from "@/components/ExpertContact";
import { supabase } from "@/integrations/supabase/client";
import { darvaCoherence, darvaForCase } from "@/lib/darva";
import { analyzeExpertReportFn } from "@/lib/bodyshop-ai.functions";
import {
  CASE_STATES,
  CLIENT_TEMPLATES,
  DOC_TYPES,
  PART_STATUSES,
  PAYMENT_KINDS,
  PHYSICAL_STATES,
  WORK_LOCATIONS,
  type CaseComm,
  type CaseDoc,
  type CaseEvent,
  type CasePart,
  type CasePayment,
  type CaseSupplement,
  type CaseTask,
  canClose,
  fillTemplate,
  financialBalance,
  getCase,
  logEvent,
  stateLabel,
  stateTone,
  updateCase,
} from "@/lib/bodyshop";
import { sendModuleEmailFn } from "@/lib/module-email.functions";
import { blobToDataUrl, BUCKET, compressImage } from "@/lib/photo";
import { formatPlate } from "@/lib/plate";
import { expertEmailFor, listExperts, listFirms, listSuppliers } from "@/lib/referentials";

export const Route = createFileRoute("/carrosserie/$caseId")({
  head: () => ({
    meta: [
      { title: "Dossier carrosserie — DDA Connect" },
      { name: "description", content: "Suivi complet d'un dossier carrosserie : expert, pièces, imprévus, client et paiements." },
      { property: "og:title", content: "Dossier carrosserie — DDA Connect" },
      { property: "og:description", content: "Timeline, documents experts, pièces et suivi financier du dossier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CaseView,
});

const TABS = ["Infos", "Documents", "Tâches", "Pièces", "Imprévus", "Client", "Finances", "Timeline"] as const;

function CaseView() {
  const { caseId } = Route.useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Infos");

  const c = useQuery({ queryKey: ["case", caseId], queryFn: () => getCase(caseId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["case", caseId] });
    void qc.invalidateQueries({ queryKey: ["case-sub", caseId] });
    void qc.invalidateQueries({ queryKey: ["bodyshop-cases"] });
  };

  if (c.isLoading) return <AppShell title="Dossier" back={{ to: "/carrosserie" }}><p className="text-sm text-muted-foreground">Chargement…</p></AppShell>;
  const row = c.data;
  if (!row) return <AppShell title="Dossier" back={{ to: "/carrosserie" }}><p className="text-sm text-muted-foreground">Dossier introuvable.</p></AppShell>;

  return (
    <AppShell title={formatPlate(row.plate ?? "")} subtitle={row.customer_name ?? row.vehicle_label ?? ""} back={{ to: "/carrosserie" }}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={stateTone(row.case_state)}>{stateLabel(row.case_state)}</Badge>
        {row.is_vge ? <Badge tone="bg-red-200 text-red-950">VGE</Badge> : null}
        {row.is_hail ? <Badge tone="bg-blue-100 text-blue-900">Grêle</Badge> : null}
        {row.work_location !== "site" ? <Badge tone="bg-purple-100 text-purple-900">Sous-traitance</Badge> : null}
      </div>

      <div className="mt-3 space-y-2">
        <DarvaAlertBanner caseId={caseId} plate={row.plate} missionOrigin={row.mission_origin} />
        <ExpertContact row={row} onSent={refresh} />
      </div>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`shrink-0 rounded-lg border-2 px-3 py-2 text-sm font-bold ${tab === t ? "border-brand bg-brand/10" : "border-border"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === "Infos" ? <InfosTab row={row} onSaved={refresh} /> : null}
        {tab === "Documents" ? <DocsTab caseId={caseId} onSaved={refresh} /> : null}
        {tab === "Tâches" ? <TasksTab caseId={caseId} /> : null}
        {tab === "Pièces" ? <PartsTab caseId={caseId} plate={row.plate ?? ""} orNumber={row.or_number ?? ""} /> : null}
        {tab === "Imprévus" ? <SupplementsTab row={row} onSaved={refresh} /> : null}
        {tab === "Client" ? <ClientTab row={row} /> : null}
        {tab === "Finances" ? <MoneyTab row={row} onSaved={refresh} /> : null}
        {tab === "Timeline" ? <TimelineTab caseId={caseId} /> : null}
      </div>
    </AppShell>
  );
}

/* ---------------- Infos ---------------- */

function DarvaAlertBanner({
  caseId,
  plate,
  missionOrigin,
}: {
  caseId: string;
  plate: string | null;
  missionOrigin: string | null;
}) {
  const flows = useQuery({ queryKey: ["darva-case", caseId], queryFn: () => darvaForCase(caseId, plate) });
  if (!flows.data) return null;
  const alert = darvaCoherence(missionOrigin, flows.data);
  if (!alert) return null;
  return (
    <p
      className={`rounded-xl border-2 px-3 py-2 text-xs font-bold ${
        alert.tone === "warn" ? "border-status-watch bg-status-watch-soft text-status-watch" : "border-border bg-secondary"
      }`}
    >
      {alert.message}
    </p>
  );
}

function InfosTab({ row, onSaved }: { row: NonNullable<Awaited<ReturnType<typeof getCase>>>; onSaved: () => void }) {
  const [caseState, setCaseState] = useState(row.case_state);
  const [physical, setPhysical] = useState(row.physical_state);
  const [location, setLocation] = useState(row.work_location);
  const [nextAction, setNextAction] = useState(row.next_action ?? "");
  const [blocker, setBlocker] = useState(row.blocker ?? "");
  const [appointment, setAppointment] = useState(row.appointment_at?.slice(0, 16) ?? "");
  const [entry, setEntry] = useState(row.entry_at?.slice(0, 16) ?? "");
  const [expected, setExpected] = useState(row.expected_return_at?.slice(0, 16) ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    if (caseState === "dossier_clos" && !canClose(row)) {
      setMsg("Impossible de clore : il reste des sommes à encaisser.");
      return;
    }
    setSaving(true);
    await updateCase(
      row.id,
      {
        case_state: caseState,
        physical_state: physical,
        work_location: location,
        next_action: nextAction || null,
        blocker: blocker || null,
        appointment_at: appointment ? new Date(appointment).toISOString() : null,
        entry_at: entry ? new Date(entry).toISOString() : null,
        expected_return_at: expected ? new Date(expected).toISOString() : null,
        closed_at: caseState === "dossier_clos" ? new Date().toISOString() : null,
      },
      { label: `État : ${stateLabel(caseState)}` },
    );
    setSaving(false);
    setMsg("Enregistré.");
    onSaved();
  }

  return (
    <div className="space-y-3">
      <Select label="État du dossier" value={caseState} onChange={setCaseState} options={CASE_STATES.map((s) => ({ key: s.key, label: s.label }))} allowEmpty={false} />
      <Select label="État physique du véhicule" value={physical} onChange={setPhysical} options={PHYSICAL_STATES.map((s) => ({ key: s.key, label: s.label }))} allowEmpty={false} />
      <Select label="Lieu des travaux" value={location} onChange={setLocation} options={WORK_LOCATIONS.map((s) => ({ key: s.key, label: s.label }))} allowEmpty={false} />
      <Field label="Prochaine action" value={nextAction} onChange={setNextAction} />
      <Field label="Blocage" value={blocker} onChange={setBlocker} />
      <Field label="RDV" value={appointment} onChange={setAppointment} type="datetime-local" />
      <Field label="Entrée véhicule" value={entry} onChange={setEntry} type="datetime-local" />
      <Field label="Restitution prévue" value={expected} onChange={setExpected} type="datetime-local" />
      {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}
      <button onClick={() => void save()} disabled={saving} className="w-full rounded-xl bg-brand py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-50">
        Enregistrer
      </button>
    </div>
  );
}

/* ---------------- Documents ---------------- */

function DocsTab({ caseId, onSaved }: { caseId: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("rapport_expertise");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const docs = useQuery({
    queryKey: ["case-sub", caseId, "docs"],
    queryFn: async () => {
      const { data } = await supabase.from("bodyshop_documents").select("*").eq("case_id", caseId).order("created_at", { ascending: false });
      return (data ?? []) as CaseDoc[];
    },
  });

  async function upload(file: File) {
    setBusy(true);
    setMsg("");
    try {
      const isImage = file.type.startsWith("image/");
      const blob = isImage ? await compressImage(file, 2000, 0.85) : file;
      const path = `carrosserie/${caseId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: file.type || "application/octet-stream" });
      if (error) throw error;
      const { data: doc } = await supabase
        .from("bodyshop_documents")
        .insert({ case_id: caseId, doc_type: docType, label: file.name, storage_path: path, mime_type: file.type, file_size: file.size, analysis_status: "pending" })
        .select()
        .single();

      if (docType === "rapport_expertise") {
        setMsg("Analyse du rapport en cours…");
        const dataUrl = await blobToDataUrl(blob);
        const res = await analyzeExpertReportFn({ data: { dataUrl, filename: file.name } });
        if (res.ok) {
          const parsed = JSON.parse(res.json) as Record<string, unknown>;
          await supabase.from("bodyshop_documents").update({ analysis: parsed as never, analysis_status: "done" }).eq("id", (doc as CaseDoc).id);
          await applyReport(caseId, parsed);
          setMsg("Rapport analysé : champs proposés appliqués, vérifie les valeurs incertaines.");
        } else {
          await supabase.from("bodyshop_documents").update({ analysis_status: "error" }).eq("id", (doc as CaseDoc).id);
          setMsg(res.error);
        }
      } else {
        setMsg("Document ajouté.");
      }
      await logEvent({ caseId, kind: "document", label: `Document ajouté : ${file.name}`, detail: docType });
      void qc.invalidateQueries({ queryKey: ["case-sub", caseId] });
      onSaved();
    } catch {
      setMsg("Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Select label="Type de document" value={docType} onChange={setDocType} options={DOC_TYPES.map((d) => ({ key: d.key, label: d.label }))} allowEmpty={false} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex w-full items-center gap-3 rounded-xl bg-brand px-4 py-4 text-brand-foreground disabled:opacity-50">
        {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
        <span className="text-base font-extrabold uppercase tracking-wide">Ajouter / photographier</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}

      <ul className="space-y-2">
        {(docs.data ?? []).map((d) => (
          <li key={d.id} className="card-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{d.label ?? d.storage_path}</div>
                <div className="text-xs text-muted-foreground">
                  {DOC_TYPES.find((t) => t.key === d.doc_type)?.label ?? d.doc_type} · {new Date(d.created_at).toLocaleDateString("fr-FR")}
                </div>
              </div>
              {d.analysis_status === "done" ? <Badge tone="bg-emerald-200 text-emerald-950">Analysé</Badge> : null}
              {d.analysis_status === "error" ? <Badge tone="bg-red-200 text-red-950">Échec</Badge> : null}
            </div>
            {d.analysis ? <AnalysisSummary analysis={d.analysis as Record<string, unknown>} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisSummary({ analysis }: { analysis: Record<string, unknown> }) {
  const uncertain = (analysis["uncertain"] as string[] | undefined) ?? [];
  const totals = (analysis["totals"] as Record<string, unknown> | undefined) ?? {};
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-secondary px-3 py-2 text-xs">
      <div>Sinistre : {String(analysis["claim_number"] ?? "—")} · Franchise : {String(analysis["franchise"] ?? "—")} €</div>
      <div>Total HT : {String(totals["ht"] ?? "—")} € · TTC : {String(totals["ttc"] ?? "—")} €</div>
      {uncertain.length ? <div className="text-amber-800">À vérifier : {uncertain.join(", ")}</div> : null}
    </div>
  );
}

async function applyReport(caseId: string, a: Record<string, unknown>) {
  const totals = (a["totals"] as Record<string, unknown>) ?? {};
  const patch: Record<string, unknown> = {};
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  if (a["claim_number"]) patch["claim_number"] = a["claim_number"];
  if (a["mission_number"]) patch["mission_number"] = a["mission_number"];
  if (num(a["franchise"]) !== null) patch["franchise"] = num(a["franchise"]);
  if (num(a["vat_rate"]) !== null) patch["vat_rate"] = num(a["vat_rate"]);
  if (num(a["depreciation"]) !== null) patch["depreciation"] = num(a["depreciation"]);
  if (num(totals["ht"]) !== null) patch["amount_total_ht"] = num(totals["ht"]);
  if (num(totals["ttc"]) !== null) patch["amount_total_ttc"] = num(totals["ttc"]);
  if (num(totals["insurer_part"]) !== null) patch["amount_insurer_expected"] = num(totals["insurer_part"]);
  if (num(a["franchise"]) !== null) patch["amount_franchise_expected"] = num(a["franchise"]);
  if (a["vge"] === true) patch["is_vge"] = true;
  patch["case_state"] = "rapport_recu";
  await supabase.from("bodyshop_cases").update(patch as never).eq("id", caseId);

  const parts = (a["parts"] as Record<string, unknown>[] | undefined) ?? [];
  if (parts.length) {
    await supabase.from("bodyshop_parts").insert(
      parts.slice(0, 60).map((p) => ({
        case_id: caseId,
        label: String(p["label"] ?? p["reference"] ?? "Pièce"),
        reference: p["reference"] ? String(p["reference"]) : null,
        quantity: p["quantity"] ? Number(p["quantity"]) : 1,
        unit_price: p["unit_price"] ? Number(p["unit_price"]) : null,
        status: "prevue_rapport",
      })) as never,
    );
  }

  const instructions = (a["instructions"] as string[] | undefined) ?? [];
  if (instructions.length) {
    await supabase.from("bodyshop_tasks").insert(
      instructions.slice(0, 20).map((i) => ({ case_id: caseId, label: i, origin: "rapport" })) as never,
    );
  }
  await logEvent({ caseId, kind: "rapport", label: "Rapport d'expertise analysé", detail: `${parts.length} pièce(s), ${instructions.length} consigne(s)` });
}

/* ---------------- Tâches ---------------- */

function TasksTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const tasks = useQuery({
    queryKey: ["case-sub", caseId, "tasks"],
    queryFn: async () => {
      const { data } = await supabase.from("bodyshop_tasks").select("*").eq("case_id", caseId).order("done").order("created_at");
      return (data ?? []) as CaseTask[];
    },
  });
  const reload = () => void qc.invalidateQueries({ queryKey: ["case-sub", caseId] });

  async function add() {
    if (!label.trim()) return;
    await supabase.from("bodyshop_tasks").insert({ case_id: caseId, label: label.trim(), origin: "manuel" });
    setLabel("");
    reload();
  }
  async function toggle(t: CaseTask) {
    await supabase.from("bodyshop_tasks").update({ done: !t.done, done_at: t.done ? null : new Date().toISOString() }).eq("id", t.id);
    if (!t.done) await logEvent({ caseId, kind: "tache", label: `Consigne réalisée : ${t.label}` });
    reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nouvelle consigne" className="flex-1 rounded-lg border-2 border-border bg-card px-3 py-3" />
        <button onClick={() => void add()} className="rounded-lg bg-brand px-4 text-brand-foreground"><Plus className="h-5 w-5" /></button>
      </div>
      <ul className="space-y-2">
        {(tasks.data ?? []).map((t) => (
          <li key={t.id}>
            <button onClick={() => void toggle(t)} className="flex w-full items-center gap-3 rounded-xl border-2 border-border bg-card px-3 py-3 text-left">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${t.done ? "border-brand bg-brand text-brand-foreground" : "border-border"}`}>
                {t.done ? <Check className="h-4 w-4" /> : null}
              </span>
              <span className={`flex-1 text-sm ${t.done ? "line-through text-muted-foreground" : "font-medium"}`}>{t.label}</span>
              {t.origin === "rapport" ? <Badge tone="bg-blue-100 text-blue-900">Expert</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Pièces ---------------- */

function PartsTab({ caseId, plate, orNumber }: { caseId: string; plate: string; orNumber: string }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [reference, setReference] = useState("");
  const parts = useQuery({
    queryKey: ["case-sub", caseId, "parts"],
    queryFn: async () => {
      const { data } = await supabase.from("bodyshop_parts").select("*").eq("case_id", caseId).order("created_at");
      return (data ?? []) as CasePart[];
    },
  });
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: listSuppliers });
  const reload = () => void qc.invalidateQueries({ queryKey: ["case-sub", caseId] });

  async function add() {
    if (!label.trim()) return;
    await supabase.from("bodyshop_parts").insert({ case_id: caseId, label: label.trim(), reference: reference || null, status: "a_commander" });
    setLabel("");
    setReference("");
    reload();
  }

  async function setStatus(p: CasePart, status: string) {
    const patch: Record<string, unknown> = { status };
    if (status === "commandee") patch["ordered_at"] = new Date().toISOString().slice(0, 10);
    if (status === "recue") patch["received_at"] = new Date().toISOString().slice(0, 10);
    await supabase.from("bodyshop_parts").update(patch as never).eq("id", p.id);
    await logEvent({ caseId, kind: "piece", label: `${p.label} → ${PART_STATUSES.find((s) => s.key === status)?.label ?? status}` });
    reload();
  }

  async function toReturn(p: CasePart) {
    const { data } = await supabase
      .from("part_returns")
      .insert({
        supplier_id: p.supplier_id,
        case_id: caseId,
        plate: plate || null,
        or_number: orNumber || null,
        status: "demande_creee",
        expected_amount: p.unit_price ? Number(p.unit_price) * Number(p.quantity ?? 1) : null,
      })
      .select()
      .single();
    if (data) {
      await supabase.from("part_return_lines").insert({
        return_id: (data as { id: string }).id,
        bodyshop_part_id: p.id,
        label: p.label,
        reference: p.reference,
        quantity: p.quantity ?? 1,
        item_type: p.is_deposit ? "consigne" : "piece",
        unit_price: p.unit_price,
      });
      await supabase.from("bodyshop_parts").update({ status: "a_retourner" }).eq("id", p.id);
      await logEvent({ caseId, kind: "retour", label: `Retour demandé : ${p.label}` });
      reload();
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
        <Field label="Pièce" value={label} onChange={setLabel} />
        <Field label="Référence" value={reference} onChange={setReference} />
        <button onClick={() => void add()} className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground">Ajouter la pièce</button>
      </div>

      <ul className="space-y-2">
        {(parts.data ?? []).map((p) => (
          <li key={p.id} className="card-surface space-y-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{p.label}</div>
                <div className="text-xs text-muted-foreground">
                  {p.reference ?? "—"} · qté {Number(p.quantity ?? 1)}
                  {p.unit_price ? ` · ${Number(p.unit_price).toFixed(2)} €` : ""}
                  {p.supplier_id ? ` · ${suppliers.data?.find((s) => s.id === p.supplier_id)?.name ?? ""}` : ""}
                </div>
              </div>
              <Badge>{PART_STATUSES.find((s) => s.key === p.status)?.label ?? p.status}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {["a_commander", "commandee", "recue", "manquante", "non_utilisee"].map((s) => (
                <button key={s} onClick={() => void setStatus(p, s)} className="rounded-md border-2 border-border px-2 py-1 text-xs font-bold">
                  {PART_STATUSES.find((x) => x.key === s)?.label}
                </button>
              ))}
              <button onClick={() => void toReturn(p)} className="rounded-md bg-secondary px-2 py-1 text-xs font-bold">Créer un retour</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Imprévus ---------------- */

function SupplementsTab({ row, onSaved }: { row: NonNullable<Awaited<ReturnType<typeof getCase>>>; onSaved: () => void }) {
  const caseId = row.id;
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const firms = useQuery({ queryKey: ["firms"], queryFn: listFirms });
  const experts = useQuery({ queryKey: ["experts"], queryFn: listExperts });
  const items = useQuery({
    queryKey: ["case-sub", caseId, "supp"],
    queryFn: async () => {
      const { data } = await supabase.from("bodyshop_supplements").select("*").eq("case_id", caseId).order("created_at", { ascending: false });
      return (data ?? []) as CaseSupplement[];
    },
  });

  async function addPhoto(file: File) {
    const blob = await compressImage(file, 1800, 0.85);
    const path = `carrosserie/${caseId}/supp-${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (!error) setPhotos((p) => [...p, path]);
  }

  async function send() {
    if (!description.trim()) {
      setMsg("Décris l'imprévu.");
      return;
    }
    setBusy(true);
    const expert = experts.data?.find((e) => e.id === row.expert_id) ?? null;
    const firm = firms.data?.find((f) => f.id === row.expert_firm_id) ?? null;
    const to = expertEmailFor("complement", expert, firm);
    const { data: created } = await supabase
      .from("bodyshop_supplements")
      .insert({ case_id: caseId, description: description.trim(), photos, status: to ? "envoye" : "brouillon", sent_to: to || null, sent_at: to ? new Date().toISOString() : null })
      .select()
      .single();

    if (to) {
      const links = await Promise.all(
        photos.map(async (p, i) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(p, 60 * 60 * 24 * 14);
          return { label: `Photo ${i + 1}`, url: data?.signedUrl ?? "" };
        }),
      );
      const res = await sendModuleEmailFn({
        data: {
          to,
          subject: `Demande de complément — ${row.plate ?? ""} ${row.claim_number ? `· sinistre ${row.claim_number}` : ""}`.trim(),
          body: `Bonjour,\n\nVéhicule ${row.plate ?? ""} ${row.vehicle_label ?? ""}\nSinistre : ${row.claim_number ?? "—"}\n\n${description.trim()}\n\nMerci de nous transmettre votre accord.\n\nCordialement,`,
          kind: "complement_expert",
          links: links.filter((l) => l.url),
        },
      });
      setMsg(res.ok ? "Demande envoyée à l'expert." : res.error || "Envoi impossible.");
      if (!res.ok && created) await supabase.from("bodyshop_supplements").update({ status: "brouillon" }).eq("id", (created as CaseSupplement).id);
    } else {
      setMsg("Aucune adresse expert : demande enregistrée en brouillon.");
    }

    await updateCase(caseId, { case_state: "attente_complement" }, { label: "Demande de complément envoyée" });
    setDescription("");
    setPhotos([]);
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ["case-sub", caseId] });
    onSaved();
  }

  async function respond(s: CaseSupplement, status: string) {
    await supabase.from("bodyshop_supplements").update({ status, responded_at: new Date().toISOString() }).eq("id", s.id);
    await logEvent({ caseId, kind: "complement", label: `Complément ${status}` });
    void qc.invalidateQueries({ queryKey: ["case-sub", caseId] });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
        <button onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg bg-secondary px-3 py-3">
          <Camera className="h-5 w-5" />
          <span className="text-sm font-bold uppercase">Photographier le dégât caché ({photos.length})</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addPhoto(f);
            e.target.value = "";
          }}
        />
        <Area label="Description" value={description} onChange={setDescription} rows={4} />
        <button onClick={() => void send()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Envoyer à l'expert
        </button>
        {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}
      </div>

      <ul className="space-y-2">
        {(items.data ?? []).map((s) => (
          <li key={s.id} className="card-surface space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <Badge>{s.status}</Badge>
              <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString("fr-FR")}</span>
            </div>
            <p className="text-sm">{s.description}</p>
            <div className="flex gap-2">
              <button onClick={() => void respond(s, "accepte")} className="rounded-md border-2 border-border px-2 py-1 text-xs font-bold">Accepté</button>
              <button onClick={() => void respond(s, "refuse")} className="rounded-md border-2 border-border px-2 py-1 text-xs font-bold">Refusé</button>
              <button onClick={() => void respond(s, "partiel")} className="rounded-md border-2 border-border px-2 py-1 text-xs font-bold">Partiel</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Client ---------------- */

function ClientTab({ row }: { row: NonNullable<Awaited<ReturnType<typeof getCase>>> }) {
  const qc = useQueryClient();
  const [tpl, setTpl] = useState<string>("rdv_confirme");
  const template = CLIENT_TEMPLATES.find((t) => t.key === tpl)!;
  const [subject, setSubject] = useState<string>(template.subject);
  const [body, setBody] = useState<string>(fillTemplate(template.body, row));
  const [to, setTo] = useState(row.customer_email ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const comms = useQuery({
    queryKey: ["case-sub", row.id, "comms"],
    queryFn: async () => {
      const { data } = await supabase.from("bodyshop_communications").select("*").eq("case_id", row.id).order("created_at", { ascending: false });
      return (data ?? []) as CaseComm[];
    },
  });

  function pick(key: string) {
    setTpl(key);
    const t = CLIENT_TEMPLATES.find((x) => x.key === key)!;
    setSubject(t.subject);
    setBody(fillTemplate(t.body, row));
  }

  async function send() {
    if (!to) {
      setMsg("Adresse e-mail manquante.");
      return;
    }
    setBusy(true);
    const res = await sendModuleEmailFn({ data: { to, subject, body, kind: "client_carrosserie" } });
    await supabase.from("bodyshop_communications").insert({
      case_id: row.id,
      channel: "email",
      template_key: tpl,
      recipient: to,
      subject,
      body,
      status: res.ok ? "sent" : "error",
      error_message: res.ok ? null : res.error,
      sent_at: res.ok ? new Date().toISOString() : null,
    });
    await logEvent({ caseId: row.id, kind: "client", label: `Message client : ${subject}` });
    setMsg(res.ok ? "Message envoyé." : res.error || "Envoi impossible.");
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ["case-sub", row.id] });
  }

  return (
    <div className="space-y-3">
      <Select label="Modèle" value={tpl} onChange={pick} options={CLIENT_TEMPLATES.map((t) => ({ key: t.key, label: t.label }))} allowEmpty={false} />
      <Field label="Destinataire" value={to} onChange={setTo} type="email" />
      <Field label="Objet" value={subject} onChange={setSubject} />
      <Area label="Message" value={body} onChange={setBody} rows={8} />
      {msg ? <p className="rounded-lg bg-secondary px-3 py-2 text-sm">{msg}</p> : null}
      <button onClick={() => void send()} disabled={busy} className="w-full rounded-xl bg-brand py-4 text-base font-extrabold uppercase text-brand-foreground disabled:opacity-50">
        Envoyer au client
      </button>

      <Section title="Historique">
        <ul className="space-y-2">
          {(comms.data ?? []).map((c) => (
            <li key={c.id} className="card-surface p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-bold">{c.subject}</span>
                <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString("fr-FR")}</span>
              </div>
              <div className="text-xs text-muted-foreground">{c.recipient} · {c.status}</div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

/* ---------------- Finances ---------------- */

function MoneyTab({ row, onSaved }: { row: NonNullable<Awaited<ReturnType<typeof getCase>>>; onSaved: () => void }) {
  const qc = useQueryClient();
  const bal = financialBalance(row);
  const [kind, setKind] = useState("assurance");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const payments = useQuery({
    queryKey: ["case-sub", row.id, "pay"],
    queryFn: async () => {
      const { data } = await supabase.from("bodyshop_payments").select("*").eq("case_id", row.id).order("created_at", { ascending: false });
      return (data ?? []) as CasePayment[];
    },
  });

  async function addPayment() {
    const v = Number(amount.replace(",", "."));
    if (!v) return;
    await supabase.from("bodyshop_payments").insert({ case_id: row.id, kind, amount: v, reference: reference || null, received_at: new Date().toISOString().slice(0, 10) });
    const col = `amount_${kind === "assurance" ? "insurer" : kind === "franchise" ? "franchise" : kind === "vetuste" ? "depreciation" : kind === "tva" ? "vat" : "other"}_received`;
    const current = Number((row as unknown as Record<string, number | null>)[col] ?? 0);
    await supabase.from("bodyshop_cases").update({ [col]: current + v } as never).eq("id", row.id);
    await logEvent({ caseId: row.id, kind: "paiement", label: `Encaissement ${kind} : ${v.toFixed(2)} €` });
    setAmount("");
    setReference("");
    void qc.invalidateQueries({ queryKey: ["case-sub", row.id] });
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border-2 border-border bg-card p-3">
          <div className="text-xl font-extrabold">{bal.expected.toFixed(2)} €</div>
          <div className="text-[11px] font-bold uppercase text-muted-foreground">Attendu</div>
        </div>
        <div className="rounded-xl border-2 border-border bg-card p-3">
          <div className="text-xl font-extrabold">{bal.received.toFixed(2)} €</div>
          <div className="text-[11px] font-bold uppercase text-muted-foreground">Encaissé</div>
        </div>
        <div className={`rounded-xl border-2 p-3 ${bal.remaining > 0 ? "border-red-400 bg-red-50" : "border-emerald-400 bg-emerald-50"}`}>
          <div className="text-xl font-extrabold">{bal.remaining.toFixed(2)} €</div>
          <div className="text-[11px] font-bold uppercase text-muted-foreground">Reste dû</div>
        </div>
      </div>
      <p className="rounded-lg bg-secondary px-3 py-2 text-xs">
        Travaux terminés ≠ dossier clos : le dossier ne peut être clos que lorsque tout est encaissé.
      </p>

      <div className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
        <Select label="Type d'encaissement" value={kind} onChange={setKind} options={PAYMENT_KINDS.map((k) => ({ key: k.key, label: k.label }))} allowEmpty={false} />
        <Field label="Montant (€)" value={amount} onChange={setAmount} />
        <Field label="Référence" value={reference} onChange={setReference} />
        <button onClick={() => void addPayment()} className="w-full rounded-lg bg-brand py-3 text-sm font-extrabold uppercase text-brand-foreground">Enregistrer l'encaissement</button>
      </div>

      <ul className="space-y-2">
        {(payments.data ?? []).map((p) => (
          <li key={p.id} className="card-surface flex justify-between p-3 text-sm">
            <span className="font-bold">{PAYMENT_KINDS.find((k) => k.key === p.kind)?.label ?? p.kind}</span>
            <span>{Number(p.amount).toFixed(2)} €</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Timeline ---------------- */

function TimelineTab({ caseId }: { caseId: string }) {
  const events = useQuery({
    queryKey: ["case-sub", caseId, "events"],
    queryFn: async () => {
      const { data } = await supabase.from("bodyshop_events").select("*").eq("case_id", caseId).order("occurred_at", { ascending: false });
      return (data ?? []) as CaseEvent[];
    },
  });
  return (
    <ul className="space-y-2">
      {(events.data ?? []).map((e) => (
        <li key={e.id} className="card-surface p-3">
          <div className="flex justify-between gap-2">
            <span className="text-sm font-bold">{e.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{new Date(e.occurred_at).toLocaleString("fr-FR")}</span>
          </div>
          {e.detail ? <p className="text-xs text-muted-foreground">{e.detail}</p> : null}
          {e.created_by_name ? <p className="text-[11px] text-muted-foreground">{e.created_by_name}</p> : null}
        </li>
      ))}
    </ul>
  );
}
