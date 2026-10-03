import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ImagePlus, Video, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/AppShell";
import { TireTreadOverlay } from "@/components/TireTreadOverlay";
import { extractVideoFrames } from "@/lib/video-frames.browser";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { analyzeTireStep, saveTireStep, tireStepBudget } from "@/lib/tire-step.functions";
import {
  EXPERIMENTAL_DEPTH_NOTICE, TIRE_STEP_DEFAULT_MODEL, TIRE_STEP_MODELS, isAsymmetric, resolveInnerSide, zoneLabels, type Orientation, quoteSearchFromResult, wearLevel, type TireStepResult,
} from "@/lib/tire-step";

const search = z.object({ plate: z.string().optional(), or: z.string().optional() });

export const Route = createFileRoute("/etape-pneu")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "État pneus — DDA Connect" },
      { name: "description", content: "Photos du flanc et de la bande de roulement : lecture des marquages, analyse d'usure et profil client." },
      { property: "og:title", content: "État pneus — DDA Connect" },
      { property: "og:description", content: "Lecture du flanc, usure et profil de profondeur expérimental." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TireStepPage,
});

type Role = "tread" | "sidewall" | "other";
type Img = { role: Role; dataUrl: string; fromVideo?: boolean };
type Perf = { model: string; source: "Photo" | "Vidéo"; images: number; durationMs: number; credits: number; tokensIn: number | null; tokensOut: number | null; cached: boolean };
const ROLE_LABEL: Record<Role, string> = { tread: "Bande de roulement", sidewall: "Flanc", other: "Complément" };
const ZONE: Record<string, string> = { interieur: "intérieur", centre: "centre", exterieur: "extérieur", epaules: "épaules" };
const IND: Record<string, string> = { non_visible: "non visible", visible: "visible", proche: "proche", atteint: "atteint" };
const CONF: Record<string, string> = { elevee: "élevée", moyenne: "moyenne", faible: "faible" };

function TireStepPage() {
  const sp = Route.useSearch();
  const { displayName } = useAuth();
  const { site } = useSite();
  const analyzeFn = useServerFn(analyzeTireStep);
  const saveFn = useServerFn(saveTireStep);
  const budgetFn = useServerFn(tireStepBudget);

  const [images, setImages] = useState<Img[]>([]);
  const [role, setRole] = useState<Role>("tread");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TireStepResult | null>(null);
  const [edit, setEdit] = useState<TireStepResult | null>(null);
  const [model, setModel] = useState("");
  const [chosenModel, setChosenModel] = useState<string>(TIRE_STEP_DEFAULT_MODEL);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [sessionCredits, setSessionCredits] = useState(0);
  const [sessionRuns, setSessionRuns] = useState(0);
  const [orient, setOrient] = useState<Orientation>("auto");
  const [videoBusy, setVideoBusy] = useState(false);
  const vid = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [budget, setBudget] = useState<{ daily: number; spentToday: number; remaining: number } | null>(null);
  const [plate, setPlate] = useState(sp.plate ?? "");
  const [orNumber, setOrNumber] = useState(sp.or ?? "");
  const [position, setPosition] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const imp = useRef<HTMLInputElement>(null);

  useEffect(() => { budgetFn().then(setBudget).catch(() => undefined); }, [budgetFn]);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const added: Img[] = [];
    for (const f of Array.from(list)) {
      try {
        const blob = await compressImage(f, 1800, 0.85);
        added.push({ role, dataUrl: await blobToDataUrl(blob) });
      } catch {
        toast.error("Photo illisible (HEIC ?) — reprenez-la en JPEG.");
      }
    }
    setImages((cur) => [...cur, ...added].slice(0, 6));
    // Après la bande de roulement, on propose naturellement le flanc.
    if (role === "tread") setRole("sidewall");
  }

  async function addVideo(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setVideoBusy(true);
    try {
      const frames = await extractVideoFrames(f, 10);
      // Une vidéo remplace les anciennes images de bande de roulement (flanc conservé).
      setImages((cur) => [...frames.map((dataUrl) => ({ role: "tread" as Role, dataUrl, fromVideo: true })), ...cur.filter((i) => i.role !== "tread")].slice(0, 16));
      toast.success(`${frames.length} images extraites de la vidéo`);
      setRole("sidewall");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Vidéo illisible — réessayez en photo.");
    } finally { setVideoBusy(false); }
  }

  async function analyze(force: boolean) {
    if (!images.length) { toast.error("Ajoutez au moins une photo."); return; }
    setBusy(true); setError("");
    try {
      const t0 = performance.now();
      const r = await analyzeFn({ data: { images: images.map(({ role, dataUrl }) => ({ role, dataUrl })), force, model: chosenModel, siteId: site?.id ?? null } });
      setBudget(r.budget); setModel(r.model);
      const m = r.metrics;
      setPerf({
        model: r.model, source: images.some((i) => i.fromVideo) ? "Vidéo" : "Photo", images: images.length,
        durationMs: m?.durationMs ?? Math.round(performance.now() - t0), credits: m?.credits ?? 0,
        tokensIn: m?.tokensIn ?? null, tokensOut: m?.tokensOut ?? null, cached: m?.cached ?? false,
      });
      if (m) { setSessionCredits((c) => c + (m.credits ?? 0)); setSessionRuns((n) => n + 1); }
      if (!r.ok || !r.result) { setError(r.error); return; }
      setResult(r.result); setEdit(structuredClone(r.result)); setSavedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse impossible.");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!edit || !result) return;
    setBusy(true);
    try {
      const r = await saveFn({ data: {
        images: images.map(({ role, dataUrl }) => ({ role, dataUrl })), siteId: site?.id ?? null, plate: plate || null, orNumber: orNumber || null, position: position || null,
        model, result: result as unknown as Record<string, unknown>, corrected: edit as unknown as Record<string, unknown>, userName: displayName || null,
      } });
      setSavedId(r.id); toast.success("État pneus enregistré");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Enregistrement impossible."); } finally { setBusy(false); }
  }

  function reset() {
    if (result && !savedId && !confirm("Abandonner l'analyse non enregistrée ?")) return;
    setImages([]); setResult(null); setEdit(null); setError(""); setSavedId(null); setRole("tread"); setPerf(null); setOrient("auto");
  }

  const sw = edit?.sidewall, d = edit?.depth, w = edit?.wear;
  const setSw = (p: Partial<TireStepResult["sidewall"]>) => edit && setEdit({ ...edit, sidewall: { ...edit.sidewall, ...p } });
  const setD = (k: "inner_mm" | "center_mm" | "outer_mm", v: string) => {
    if (!edit) return;
    const n = v.trim() === "" ? null : Number(v.replace(",", "."));
    const depth = { ...edit.depth, [k]: n !== null && Number.isFinite(n) ? n : null };
    depth.points_mm = [depth.inner_mm, depth.center_mm, depth.outer_mm].filter((x): x is number => x !== null);
    setEdit({ ...edit, depth });
  };
  const quote = edit ? quoteSearchFromResult(edit) : {};
  const labels = zoneLabels(resolveInnerSide(orient, d?.inner_side ?? null));
  const treads = images.filter((i) => i.role === "tread");
  const treadSrc = treads[Math.floor(treads.length / 2)]?.dataUrl ?? null;

  return (
    <AppShell title="État pneus" subtitle="Flanc, usure et profil de la bande de roulement" back={{ to: "/atelier" }}>
      <div className="space-y-4">
        <section className="card-surface space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            {(["tread", "sidewall", "other"] as Role[]).map((r) => (
              <button key={r} type="button" onClick={() => setRole(r)}
                className={`rounded-lg border-2 px-2 py-2 text-xs font-bold uppercase ${role === r ? "border-brand bg-brand text-brand-foreground" : "border-border"}`}>
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button type="button" onClick={() => cam.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-brand px-3 py-4 text-sm font-extrabold uppercase text-brand-foreground">
              <Camera className="h-5 w-5" /> Caméra
            </button>
            <button type="button" onClick={() => imp.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border-2 border-border px-3 py-4 text-sm font-extrabold uppercase">
              <ImagePlus className="h-5 w-5" /> Importer
            </button>
            <button type="button" disabled={videoBusy} onClick={() => vid.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border-2 border-brand px-3 py-4 text-sm font-extrabold uppercase disabled:opacity-50">
              {videoBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Video className="h-5 w-5" />} Vidéo
            </button>
          </div>
          {/* Inputs gardés dans le DOM (sr-only) : indispensable pour iPhone/Safari. */}
          <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Prendre une photo" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={vid} type="file" accept="video/*" capture="environment" className="sr-only" aria-label="Filmer la bande de roulement" onChange={(e) => { void addVideo(e.target.files); e.target.value = ""; }} />
          <input ref={imp} type="file" accept="image/*" multiple className="sr-only" aria-label="Importer des photos" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <p className="text-xs text-muted-foreground">Prochaine photo : <b>{ROLE_LABEL[role]}</b>. Minimum conseillé : une bande de roulement + un flanc (même pneu).</p>
          <p className="text-xs text-muted-foreground"><b>Vidéo</b> (bande de roulement) : 3 à 5 secondes, caméra arrière, balayez lentement toute la largeur — 10 images en sont extraites.</p>
          <label className="block text-[10px] font-bold uppercase text-muted-foreground">Modèle IA
            <select value={chosenModel} onChange={(e) => setChosenModel(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm font-normal normal-case text-foreground">
              {TIRE_STEP_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          {images.length ? (
            <div className="grid grid-cols-3 gap-2">
              {images.map((im, i) => (
                <div key={i} className="relative overflow-hidden rounded-lg border-2 border-border">
                  <img src={im.dataUrl} alt={ROLE_LABEL[im.role]} className="aspect-square w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-background/85 px-1 py-0.5 text-[10px] font-bold uppercase">{ROLE_LABEL[im.role]}{im.fromVideo ? " · vidéo" : ""}</div>
                  <button type="button" aria-label="Retirer" onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute right-1 top-1 rounded bg-background/85 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy || !images.length} onClick={() => analyze(false)} className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-4 text-sm font-extrabold uppercase text-primary-foreground disabled:opacity-50">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Analyser le pneu
            </button>
            {result ? (
              <button type="button" disabled={busy} onClick={() => analyze(true)} className="flex items-center justify-center gap-1 rounded-lg border-2 border-border px-2 py-2 text-xs font-bold uppercase"><RefreshCw className="h-4 w-4" /> Relancer</button>
            ) : null}
            <button type="button" onClick={reset} className={`rounded-lg border-2 border-border px-2 py-2 text-xs font-bold uppercase ${result ? "" : "col-span-2"}`}>Nouveau pneu</button>
          </div>
          {budget ? (
            <p className="text-[11px] text-muted-foreground">Budget IA du jour : {budget.spentToday.toFixed(2)} / {budget.daily} crédits · restant {budget.remaining.toFixed(2)}</p>
          ) : null}
          {perf ? (
            <div className="rounded-lg border-2 border-border p-3 text-xs">
              <div className="mb-1 font-extrabold uppercase">Performance IA</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span>Modèle</span><b className="break-all">{perf.model}</b>
                <span>Source</span><b>{perf.source}</b>
                <span>Images envoyées</span><b>{perf.images}</b>
                <span>Durée</span><b>{(perf.durationMs / 1000).toFixed(1)} s{perf.cached ? " (cache)" : ""}</b>
                <span>Crédits (cette analyse)</span><b>{perf.credits.toFixed(3)}</b>
                <span>Tokens entrée / sortie</span><b>{perf.tokensIn ?? "—"} / {perf.tokensOut ?? "—"}</b>
                <span>Session de test</span><b>{sessionRuns} analyse(s) · {sessionCredits.toFixed(3)} crédits</b>
              </div>
            </div>
          ) : null}
          {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        </section>

        {edit && sw && d && w ? (
          <>
            <section className="card-surface space-y-3 p-4">
              <h2 className="text-sm font-extrabold uppercase">Profondeurs sur la photo</h2>
              <div className="flex items-start gap-2 rounded-lg border-2 border-warning bg-warning/10 px-3 py-2 text-xs font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> {EXPERIMENTAL_DEPTH_NOTICE}
              </div>
              {treadSrc ? <TireTreadOverlay src={treadSrc} values={[d.inner_mm, d.center_mm, d.outer_mm]} labels={labels} /> : <p className="text-sm text-muted-foreground">Aucune photo de bande de roulement.</p>}
              <label className="block text-[10px] font-bold uppercase text-muted-foreground">Orientation (côté intérieur du véhicule sur la photo)
                <select value={orient} onChange={(e) => setOrient(e.target.value as Orientation)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm font-normal normal-case text-foreground">
                  <option value="auto">Automatique ({d.inner_side ? `IA : intérieur à ${d.inner_side}` : "IA : non déterminée"})</option>
                  <option value="gauche">Intérieur à gauche de la photo</option>
                  <option value="droite">Intérieur à droite de la photo</option>
                  <option value="inconnue">Inconnue (Gauche / Milieu / Droite)</option>
                </select>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([["inner_mm", labels[0]], ["center_mm", labels[1]], ["outer_mm", labels[2]]] as const).map(([k, l]) => {
                  const lvl = wearLevel(d[k]);
                  return (
                    <label key={k} className={`rounded-lg border-2 p-2 text-center ${lvl === "critique" ? "border-destructive" : lvl === "surveiller" ? "border-warning" : "border-border"}`}>
                      <div className="text-[10px] font-bold uppercase text-muted-foreground">{l}</div>
                      <input inputMode="decimal" value={d[k] ?? ""} onChange={(e) => setD(k, e.target.value)} className="w-full bg-transparent text-center text-xl font-extrabold" placeholder="—" />
                      <div className="text-[10px] text-muted-foreground">mm {lvl ? `· ${lvl}` : ""}</div>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Confiance : {d.confidence ? CONF[d.confidence] : "non indiquée"} · Réglette/jauge visible : {d.gauge_visible ? "oui (référence utilisée)" : "non"}
                {d.note ? ` · ${d.note}` : ""}
              </p>
              {isAsymmetric(d) ? <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm font-bold">Usure dissymétrique : écart important entre les deux bords.</p> : null}
            </section>

            <section className="card-surface space-y-2 p-4">
              <h2 className="text-sm font-extrabold uppercase">Usure constatée</h2>
              <ul className="space-y-1 text-sm">
                <li>Usure : <b>{w.pattern === "irreguliere" ? "irrégulière" : w.pattern === "reguliere" ? "régulière" : "non déterminée"}</b>{w.stronger_zone ? ` — plus marquée côté ${ZONE[w.stronger_zone]}` : ""}</li>
                <li>Témoin d'usure : <b>{w.wear_indicator ? IND[w.wear_indicator] : "non identifié"}</b></li>
                <li>Facettes : {w.facets ? "oui" : "non"} · Craquelures : {w.cracks ? "oui" : "non"} · Déformation : {w.deformation ? "oui" : "non"}</li>
                {w.observations.map((o, i) => <li key={i} className="text-muted-foreground">• {o}</li>)}
              </ul>
              {w.recommendation ? <p className="rounded-lg bg-muted px-3 py-2 text-sm"><b>Conseil atelier :</b> {w.recommendation}</p> : null}
            </section>

            <section className="card-surface space-y-2 p-4">
              <h2 className="text-sm font-extrabold uppercase">Flanc — marquages {sw.read_quality ? <span className="text-xs font-normal text-muted-foreground">(lecture {CONF[sw.read_quality]})</span> : null}</h2>
              <div className="grid grid-cols-2 gap-2">
                {([["brand", "Marque"], ["model", "Gamme / modèle"], ["size", "Dimension"], ["load_index", "Indice charge"], ["speed_index", "Indice vitesse"], ["dot", "DOT"]] as const).map(([k, l]) => (
                  <label key={k} className="text-[10px] font-bold uppercase text-muted-foreground">{l}
                    <input value={sw[k] ?? ""} onChange={(e) => setSw({ [k]: e.target.value || null } as Partial<TireStepResult["sidewall"]>)} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm font-normal normal-case text-foreground" />
                  </label>
                ))}
                {([["width", "Largeur"], ["height", "Hauteur"], ["diameter", "Diamètre"]] as const).map(([k, l]) => (
                  <label key={k} className="text-[10px] font-bold uppercase text-muted-foreground">{l}
                    <input inputMode="decimal" value={sw[k] ?? ""} onChange={(e) => { const n = Number(e.target.value.replace(",", ".")); setSw({ [k]: e.target.value && Number.isFinite(n) ? n : null } as Partial<TireStepResult["sidewall"]>); }} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm font-normal text-foreground" />
                  </label>
                ))}
                <div className="text-[10px] font-bold uppercase text-muted-foreground">Fabrication
                  <div className="mt-1 py-2 text-sm font-normal normal-case text-foreground">{sw.dot_week && sw.dot_year ? `semaine ${sw.dot_week} / ${sw.dot_year}` : "—"}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {([["xl", "XL"], ["runflat", "RunFlat"], ["three_pmsf", "3PMSF"], ["mud_snow", "M+S"]] as const).map(([k, l]) => (
                  <label key={k} className={`flex items-center gap-1 rounded-full border-2 px-3 py-1 text-xs font-bold ${sw[k] ? "border-brand" : "border-border text-muted-foreground"}`}>
                    <input type="checkbox" checked={sw[k]} onChange={(e) => setSw({ [k]: e.target.checked } as Partial<TireStepResult["sidewall"]>)} /> {l}
                  </label>
                ))}
              </div>
              {sw.homologations.length || sw.other_markings.length ? (
                <p className="text-xs text-muted-foreground">Homologations : {sw.homologations.join(", ") || "—"} · Autres : {sw.other_markings.join(", ") || "—"}</p>
              ) : null}
              <p className="text-[11px] text-muted-foreground">Modèle IA : {model}</p>
            </section>

            <section className="card-surface space-y-2 p-4">
              <h2 className="text-sm font-extrabold uppercase">Enregistrer / devis</h2>
              <div className="grid grid-cols-3 gap-2">
                <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Immat." className="rounded-lg border border-border bg-background px-2 py-2 text-sm" />
                <input value={orNumber} onChange={(e) => setOrNumber(e.target.value)} placeholder="N° OR" className="rounded-lg border border-border bg-background px-2 py-2 text-sm" />
                <select value={position} onChange={(e) => setPosition(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-2 text-sm">
                  <option value="">Position</option><option value="AVG">AV G</option><option value="AVD">AV D</option><option value="ARG">AR G</option><option value="ARD">AR D</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy || !!savedId} onClick={save} className="flex items-center justify-center gap-2 rounded-xl border-2 border-border px-3 py-3 text-xs font-extrabold uppercase disabled:opacity-50">
                  <Save className="h-4 w-4" /> {savedId ? "Enregistré" : "Enregistrer"}
                </button>
                <Link to="/devis/pneus" search={quote} className="flex items-center justify-center rounded-xl bg-brand px-3 py-3 text-xs font-extrabold uppercase text-brand-foreground">
                  Faire le devis pneu
                </Link>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
