import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Camera, FileUp, RefreshCw, Save, Copy, Download } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { DiffTable, RunCard, TruthForm } from "@/components/bench/BenchParts";
import { useAuth } from "@/lib/auth";
import { classifyLocal } from "@/lib/bench-classify";
import { buildTestExport, testToText, type BenchRun, type BenchVariant } from "@/lib/bench-export";
import { BENCH_KINDS, kindLabel, sha256Hex, type BenchKind, type BenchOutput } from "@/lib/bench-schema";
import { avg, scoreOutput, type BenchScore } from "@/lib/bench-score";
import { benchCampaignDetail, benchCampaigns, benchPrepare, benchRun, benchSaveTest, benchSettings } from "@/lib/bench.functions";

export const Route = createFileRoute("/parametrage/recette-ia")({
  head: () => ({
    meta: [
      { title: "Recette IA — banc de test documentaire — DDA Connect" },
      { name: "description", content: "Comparer qualité, vitesse et coût de deux modèles de lecture sur de vrais documents, sans créer aucune donnée métier." },
      { property: "og:title", content: "Recette IA — DDA Connect" },
      { property: "og:description", content: "Banc de test A/B des modèles de lecture de documents et photos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecetteIa,
});

type Prepared = { paths: string[]; kind: BenchKind; confidence: number | null; source: string };
type Runs = Partial<Record<BenchVariant, BenchRun>>;
const MAX_FILES = 5;

async function fileToDataUrl(f: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

async function prepareFile(f: File): Promise<{ dataUrl: string; name: string; pages: number | null }> {
  if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
    const dataUrl = await fileToDataUrl(f);
    const pages = (atob(dataUrl.split(",")[1] ?? "").match(/\/Type\s*\/Page[^s]/g) ?? []).length || null;
    return { dataUrl, name: f.name, pages };
  }
  try {
    const { compressImage } = await import("@/lib/photo");
    const blob = await compressImage(f, 2000, 0.85);
    return { dataUrl: await fileToDataUrl(blob), name: f.name, pages: 1 };
  } catch {
    if (/heic|heif/i.test(f.type) || /\.hei[cf]$/i.test(f.name)) throw new Error("Photo HEIC non lisible par ce navigateur : exportez-la en JPEG.");
    return { dataUrl: await fileToDataUrl(f), name: f.name, pages: 1 };
  }
}

function RecetteIa() {
  const { isManager } = useAuth();
  const settingsFn = useServerFn(benchSettings);
  const prepareFn = useServerFn(benchPrepare);
  const runFn = useServerFn(benchRun);
  const saveFn = useServerFn(benchSaveTest);
  const campaignsFn = useServerFn(benchCampaigns);
  const detailFn = useServerFn(benchCampaignDetail);

  const [settings, setSettings] = useState<{ candidate_model: string; daily_credits: number; budget: { daily: number; spentToday: number; remaining: number }; modelA: string; models: string[] } | null>(null);
  const [modelB, setModelB] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sha, setSha] = useState("");
  const [items, setItems] = useState<{ dataUrl: string; name: string }[]>([]);
  const [pages, setPages] = useState<number | null>(null);
  const [localText, setLocalText] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [kind, setKind] = useState<BenchKind | null>(null);
  const [runs, setRuns] = useState<Runs>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [timings, setTimings] = useState<Record<string, number | null>>({});
  const [expected, setExpected] = useState<BenchOutput | null>(null);
  const [showTruth, setShowTruth] = useState(false);
  const [bypass, setBypass] = useState(true);
  const [anon, setAnon] = useState(false);
  const [saved, setSaved] = useState(false);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [campaignId, setCampaignId] = useState<string>("");
  const [newCampaign, setNewCampaign] = useState("");
  const [summary, setSummary] = useState<{ rows: { kind: string; count: number; a: number | null; b: number | null; p: number | null }[]; credits: number; avgMs: Record<string, number | null> } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isManager) return;
    settingsFn({ data: {} }).then((s) => { setSettings(s); setModelB(s.candidate_model); }).catch((e: Error) => toast.error(e.message));
    campaignsFn().then((c) => setCampaigns(c)).catch(() => undefined);
  }, [isManager]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!prepared && !saved;

  function reset(force = false) {
    if (!force && dirty && !window.confirm("Le test courant n'est pas enregistré. L'abandonner ?")) return false;
    setFiles([]); setSha(""); setItems([]); setPages(null); setLocalText(""); setPrepared(null); setKind(null);
    setRuns({}); setTimings({}); setExpected(null); setShowTruth(false); setSaved(false);
    return true;
  }

  async function onFiles(list: FileList | File[] | null) {
    const arr = Array.from(list ?? []).slice(0, MAX_FILES);
    if (!arr.length) return;
    if (arr.some((f) => f.type === "application/pdf") && arr.length > 1) { toast.error("Un seul PDF par test (ou jusqu'à 5 photos)."); return; }
    if (!reset()) return;
    setFiles(arr);
    setBusy("Prétraitement…");
    try {
      const t0 = performance.now();
      const prep = await Promise.all(arr.map(prepareFile));
      const hash = await sha256Hex(prep.map((p) => p.dataUrl).join("\u0000"));
      const { localDocText } = await import("@/lib/doc-text.browser");
      const texts: string[] = [];
      for (const f of arr) texts.push(await localDocText(f, f.name).catch(() => ""));
      const text = texts.join("\n\n").slice(0, 40000);
      const preprocessMs = Math.round(performance.now() - t0);
      const local = classifyLocal(text);
      setItems(prep.map(({ dataUrl, name }) => ({ dataUrl, name })));
      setPages(prep.reduce((s, p) => s + (p.pages ?? 0), 0) || null);
      setSha(hash);
      setLocalText(text);
      setBusy("Envoi et classification…");
      const u0 = performance.now();
      const r = await prepareFn({ data: { sha256: hash, items: prep.map(({ dataUrl, name }) => ({ dataUrl, name })), localKind: local?.kind ?? null, localConfidence: local?.confidence ?? null, forceAi: false } });
      const roundTrip = Math.round(performance.now() - u0);
      setTimings({ preprocess_ms: preprocessMs, upload_ms: r.storeMs != null ? roundTrip : null, server_store_ms: r.storeMs, classify_total_ms: roundTrip });
      setPrepared({ paths: r.paths, kind: r.kind, confidence: r.confidence ?? null, source: r.source });
      setKind(r.kind);
      if (r.error) toast.warning(r.error);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reclassifyAi() {
    if (!prepared) return;
    setBusy("Classification IA…");
    try {
      const r = await prepareFn({ data: { sha256: sha, items, localKind: null, localConfidence: null, forceAi: true } });
      setPrepared({ ...prepared, kind: r.kind, confidence: r.confidence ?? null, source: r.source });
      setKind(r.kind);
      if (r.error) toast.warning(r.error);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function run(variants: BenchVariant[]) {
    if (!prepared || !kind) return;
    setBusy(`Analyse ${variants.join(" + ")}…`);
    setSaved(false);
    await Promise.all(variants.map(async (v) => {
      const t0 = performance.now();
      try {
        const r = await runFn({ data: { variant: v, model: v === "B" ? modelB : undefined, kind, paths: prepared.paths, text: localText, bypassCache: bypass } });
        setRuns((cur) => ({ ...cur, [v]: { ...r, totalMs: Math.round(performance.now() - t0) } }));
      } catch (e) {
        toast.error(`${v} : ${(e as Error).message}`);
      }
    }));
    setBusy(null);
  }

  const scores: Partial<Record<BenchVariant, BenchScore>> = {};
  if (expected) for (const v of ["A", "B", "pipeline"] as const) if (runs[v]) scores[v] = scoreOutput(expected, runs[v]!.parsed);

  function exportInput() {
    return {
      file_name: files.map((f) => f.name).join(" + "),
      sha256: sha,
      storage_paths: prepared?.paths ?? [],
      page_count: pages,
      photo_count: files.length,
      tested_at: new Date().toISOString(),
      detected_kind: prepared?.kind ?? null,
      kind_confidence: prepared?.confidence ?? null,
      kind_source: prepared?.source ?? null,
      corrected_kind: kind && kind !== prepared?.kind ? kind : null,
      app_version: (import.meta.env["VITE_APP_VERSION"] as string | undefined) ?? null,
      timings_client: timings,
      runs: Object.values(runs).filter(Boolean) as BenchRun[],
      expected,
    };
  }

  async function copyResult() {
    await navigator.clipboard.writeText(testToText(buildTestExport(exportInput(), anon)));
    toast.success("Résultat copié");
  }
  function download(name: string, content: string, type = "application/json") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function exportTest() {
    const e = buildTestExport(exportInput(), anon);
    download(`recette-ia-${sha.slice(0, 8)}.json`, JSON.stringify(e, null, 2));
    download(`recette-ia-${sha.slice(0, 8)}.txt`, testToText(e), "text/plain");
  }

  async function save() {
    if (!prepared) return;
    setBusy("Enregistrement…");
    try {
      const r = await saveFn({ data: {
        campaignId: campaignId || null,
        campaignName: newCampaign || undefined,
        test: {
          file_name: files.map((f) => f.name).join(" + ").slice(0, 300), mime: files[0]?.type || "application/octet-stream", sha256: sha,
          storage_paths: prepared.paths, page_count: pages, photo_count: files.length, detected_kind: prepared.kind, kind_confidence: prepared.confidence,
          kind_source: prepared.source, corrected_kind: kind !== prepared.kind ? kind : null, local_text_chars: localText.length,
          expected, scores: Object.keys(scores).length ? scores : null, timings, app_version: (import.meta.env["VITE_APP_VERSION"] as string | undefined) ?? null,
        },
        runs: Object.values(runs).filter(Boolean) as BenchRun[],
      } });
      setSaved(true);
      setCampaignId(r.campaignId);
      setNewCampaign("");
      setCampaigns(await campaignsFn());
      toast.success("Test enregistré dans la campagne");
      void loadSummary(r.campaignId);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  async function loadSummary(id = campaignId) {
    if (!id) return setSummary(null);
    const d = await detailFn({ data: { campaignId: id } });
    const byKind = new Map<string, { count: number; a: number[]; b: number[]; p: number[] }>();
    for (const t of d.tests) {
      const k = (t.corrected_kind ?? t.detected_kind ?? "other") as string;
      const e = byKind.get(k) ?? { count: 0, a: [], b: [], p: [] };
      e.count += 1;
      const sc = (t.scores ?? {}) as Partial<Record<BenchVariant, BenchScore>>;
      if (sc.A?.global.rate != null) e.a.push(sc.A.global.rate);
      if (sc.B?.global.rate != null) e.b.push(sc.B.global.rate);
      if (sc.pipeline?.global.rate != null) e.p.push(sc.pipeline.global.rate);
      byKind.set(k, e);
    }
    const avgMs: Record<string, number | null> = {};
    for (const v of ["A", "B", "pipeline"]) avgMs[v] = avg(d.runs.filter((r) => r.variant === v).map((r) => r.ai_ms));
    setSummary({
      rows: [...byKind].map(([k, e]) => ({ kind: k, count: e.count, a: avg(e.a), b: avg(e.b), p: avg(e.p) })),
      credits: Math.round(d.runs.reduce((s, r) => s + Number(r.credits ?? 0), 0) * 10000) / 10000,
      avgMs,
    });
  }

  async function exportCampaign() {
    if (!campaignId) return;
    const d = await detailFn({ data: { campaignId } });
    const tests = d.tests.map((t) => {
      const tr = d.runs.filter((r) => r.test_id === t.id).map((r): BenchRun => ({
        variant: r.variant as BenchVariant, model: r.model ?? "", promptVersion: r.prompt_version ?? "", promptHash: r.prompt_hash ?? "", promptText: r.prompt_text ?? "",
        schemaVersion: r.schema_version ?? "", docKind: r.doc_kind ?? "", startedAt: r.started_at ?? r.created_at, mediaMs: r.media_ms ?? 0, aiMs: r.ai_ms ?? 0,
        parseMs: r.parse_ms ?? 0, serverMs: r.server_ms ?? 0, totalMs: r.total_ms, tokensIn: r.tokens_in ?? 0, tokensOut: r.tokens_out ?? 0, credits: Number(r.credits ?? 0),
        httpStatus: r.http_status, success: !!r.success, cacheHit: !!r.cache_hit, failureReason: r.failure_reason, route: r.route, aiCalls: r.ai_calls ?? 0,
        parsed: (r.parsed ?? null) as BenchOutput | null, rawText: r.raw_text ?? "",
      }));
      return buildTestExport({
        file_name: t.file_name ?? "", sha256: t.sha256 ?? "", storage_paths: t.storage_paths ?? [], page_count: t.page_count, photo_count: t.photo_count ?? 1,
        tested_at: t.created_at, detected_kind: t.detected_kind, kind_confidence: t.kind_confidence, kind_source: t.kind_source, corrected_kind: t.corrected_kind,
        app_version: t.app_version, timings_client: (t.timings ?? {}) as Record<string, number | null>, runs: tr, expected: (t.expected ?? null) as BenchOutput | null,
      }, anon);
    });
    download(`campagne-${(d.campaign?.name ?? "recette").replace(/\W+/g, "-")}.json`, JSON.stringify({ campaign: d.campaign, summary, tests }, null, 2));
  }

  if (!isManager) {
    return (
      <AppShell title="Recette IA" subtitle="Banc de test documentaire" back={{ to: "/parametrage" }}>
        <p className="rounded-lg bg-accent px-3 py-3 text-sm">Accès réservé aux gérants.</p>
      </AppShell>
    );
  }

  const busyAny = !!busy;
  return (
    <AppShell title="Recette IA" subtitle="Banc de test A/B — aucune donnée métier créée" back={{ to: "/parametrage" }}>
      <div className="space-y-4 pb-24 pt-2">
        <button type="button" onClick={() => reset()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-base font-extrabold uppercase text-primary-foreground">
          <RefreshCw className="h-5 w-5" /> Nouveau test
        </button>

        <section
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFiles(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed p-4 text-center ${dragOver ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <p className="mb-3 hidden text-sm text-muted-foreground md:block">Glissez-déposez un PDF ou jusqu'à 5 photos ici</p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={busyAny} onClick={() => camRef.current?.click()} className="flex flex-col items-center gap-1 rounded-xl border-2 border-border bg-card py-5 font-bold disabled:opacity-50">
              <Camera className="h-8 w-8" /> Caméra
            </button>
            <button type="button" disabled={busyAny} onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-1 rounded-xl border-2 border-border bg-card py-5 font-bold disabled:opacity-50">
              <FileUp className="h-8 w-8" /> Importer un document
            </button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
          <input ref={fileRef} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif" className="sr-only" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
          {files.length ? <p className="mt-3 break-all text-sm font-semibold">{files.map((f) => f.name).join(", ")} {pages ? `· ${pages} page(s)` : ""}</p> : null}
          {busy ? <p className="mt-2 text-sm text-primary">{busy}</p> : null}
        </section>

        {prepared && kind ? (
          <section className="space-y-3 rounded-xl border-2 border-border bg-card p-3">
            <div className="text-sm">
              Type détecté : <b>{kindLabel(prepared.kind)}</b> · confiance {prepared.confidence != null ? `${Math.round(prepared.confidence * 100)} %` : "—"} ({prepared.source === "ia" ? "IA" : "règles locales"})
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={kind} onChange={(e) => setKind(e.target.value as BenchKind)} className="rounded-lg border-2 border-border bg-background px-2 py-2 text-sm">
                {BENCH_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
              <button type="button" disabled={busyAny} onClick={reclassifyAi} className="rounded-lg border-2 border-border px-3 py-2 text-xs font-bold">Reclasser par IA</button>
            </div>
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <div>Modèle A : <b className="break-all">{settings?.modelA}</b></div>
              <label className="flex items-center gap-2">Modèle B :
                <select value={modelB} onChange={(e) => { setModelB(e.target.value); void settingsFn({ data: { candidate_model: e.target.value } }); }} className="flex-1 rounded-lg border-2 border-border bg-background px-2 py-1">
                  {settings?.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} /> Nouvelle analyse réelle (ignorer le cache)</label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <button type="button" disabled={busyAny} onClick={() => run(["A", "B", "pipeline"])} className="col-span-2 rounded-lg bg-primary px-3 py-3 text-sm font-extrabold text-primary-foreground disabled:opacity-50">Lancer A + B + pipeline</button>
              <button type="button" disabled={busyAny} onClick={() => run(["A"])} className="rounded-lg border-2 border-border px-3 py-2 text-sm font-bold">A seul</button>
              <button type="button" disabled={busyAny} onClick={() => run(["B"])} className="rounded-lg border-2 border-border px-3 py-2 text-sm font-bold">B seul</button>
              <button type="button" disabled={busyAny} onClick={() => run(["pipeline"])} className="col-span-2 rounded-lg border-2 border-border px-3 py-2 text-sm font-bold md:col-span-4">Pipeline réel DDA seul</button>
            </div>
            <p className="text-xs text-muted-foreground">Prétraitement {timings["preprocess_ms"] ?? "—"} ms · envoi + classification {timings["classify_total_ms"] ?? "—"} ms · texte local {localText.length} caractères. </p>
            {settings ? (
              <div className="grid grid-cols-3 gap-2 rounded-lg border-2 border-border p-2 text-center text-xs">
                <div><div className="font-bold uppercase text-muted-foreground">Budget journalier configuré</div><div className="text-base font-extrabold">{settings.budget.daily} cr.</div></div>
                <div><div className="font-bold uppercase text-muted-foreground">Consommé aujourd'hui</div><div className="text-base font-extrabold">{settings.budget.spentToday.toFixed(2)} cr.</div></div>
                <div><div className="font-bold uppercase text-muted-foreground">Restant</div><div className="text-base font-extrabold">{settings.budget.remaining.toFixed(2)} cr.</div></div>
              </div>
            ) : null}
          </section>
        ) : null}

        {Object.keys(runs).length ? (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              {(["A", "B", "pipeline"] as const).map((v) => (
                <RunCard key={v} run={runs[v] ?? null} score={scores[v] ?? null} busy={busyAny} onRerun={() => run([v])} />
              ))}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-extrabold uppercase">Comparaison champ par champ</h2>
              <DiffTable a={runs.A?.parsed ?? null} b={runs.B?.parsed ?? null} pipeline={runs.pipeline?.parsed ?? null} />
            </section>
            <section className="rounded-xl border-2 border-border bg-card p-3">
              <button type="button" onClick={() => setShowTruth((v) => !v)} className="text-sm font-extrabold uppercase">
                {expected ? "Valeurs attendues renseignées ✓ — modifier" : "Renseigner les valeurs attendues"}
              </button>
              {showTruth ? <div className="mt-2"><TruthForm initial={expected ?? runs.A?.parsed ?? runs.B?.parsed ?? null} onSave={(v) => { setExpected(v); setShowTruth(false); setSaved(false); }} /></div> : null}
            </section>
            <section className="space-y-2 rounded-xl border-2 border-border bg-card p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <select value={campaignId} onChange={(e) => { setCampaignId(e.target.value); void loadSummary(e.target.value); }} className="rounded-lg border-2 border-border bg-background px-2 py-2 text-sm">
                  <option value="">— Nouvelle campagne —</option>
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {!campaignId ? <input value={newCampaign} onChange={(e) => setNewCampaign(e.target.value)} placeholder="Nom (ex. Test vision octobre 2026)" className="rounded-lg border-2 border-border bg-background px-2 py-2 text-sm" /> : null}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Export anonymisé (client, coordonnées, VIN, immat masqués)</label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <button type="button" disabled={busyAny || saved} onClick={save} className="flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{saved ? "Enregistré" : "Enregistrer"}</button>
                <button type="button" onClick={copyResult} className="flex items-center justify-center gap-1 rounded-lg border-2 border-border px-3 py-2 text-sm font-bold"><Copy className="h-4 w-4" />Copier le résultat</button>
                <button type="button" onClick={exportTest} className="flex items-center justify-center gap-1 rounded-lg border-2 border-border px-3 py-2 text-sm font-bold"><Download className="h-4 w-4" />Exporter ce test</button>
                <button type="button" disabled={!campaignId} onClick={exportCampaign} className="flex items-center justify-center gap-1 rounded-lg border-2 border-border px-3 py-2 text-sm font-bold disabled:opacity-50"><Download className="h-4 w-4" />Exporter la campagne</button>
              </div>
            </section>
          </>
        ) : null}

        {summary ? (
          <section className="rounded-xl border-2 border-border bg-card p-3 text-sm">
            <h2 className="mb-2 font-extrabold uppercase">Synthèse de la campagne</h2>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th>Type</th><th>Tests</th><th>A</th><th>B</th><th>Pipeline</th></tr></thead>
              <tbody>{summary.rows.map((r) => <tr key={r.kind} className="border-t border-border"><td className="py-1">{kindLabel(r.kind)}</td><td>{r.count}</td><td>{r.a ?? "—"}</td><td>{r.b ?? "—"}</td><td>{r.p ?? "—"}</td></tr>)}</tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">Coût cumulé {summary.credits} crédits · temps IA moyen A {summary.avgMs["A"] ?? "—"} ms, B {summary.avgMs["B"] ?? "—"} ms, pipeline {summary.avgMs["pipeline"] ?? "—"} ms</p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
