import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, ImagePlus, Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { AppShell } from "@/components/AppShell";
import { TireWearProfile } from "@/components/TireWearProfile";
import { useAuth } from "@/lib/auth";
import { useSite } from "@/lib/site-context";
import { blobToDataUrl, compressImage } from "@/lib/photo";
import { analyzeTireStep, saveTireStep, tireStepBudget } from "@/lib/tire-step.functions";
import {
  EXPERIMENTAL_DEPTH_NOTICE, isAsymmetric, quoteSearchFromResult, wearLevel, type TireStepResult,
} from "@/lib/tire-step";

const search = z.object({ plate: z.string().optional(), or: z.string().optional() });

export const Route = createFileRoute("/etape-pneu")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Étape pneu — DDA Connect" },
      { name: "description", content: "Photos du flanc et de la bande de roulement : lecture des marquages, analyse d'usure et profil client." },
      { property: "og:title", content: "Étape pneu — DDA Connect" },
      { property: "og:description", content: "Lecture du flanc, usure et profil de profondeur expérimental." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TireStepPage,
});

type Role = "tread" | "sidewall" | "other";
type Img = { role: Role; dataUrl: string };
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

  async function analyze(force: boolean) {
    if (!images.length) { toast.error("Ajoutez au moins une photo."); return; }
    setBusy(true); setError("");
    try {
      const r = await analyzeFn({ data: { images, force, siteId: site?.id ?? null } });
      setBudget(r.budget); setModel(r.model);
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
        images, siteId: site?.id ?? null, plate: plate || null, orNumber: orNumber || null, position: position || null,
        model, result: result as unknown as Record<string, unknown>, corrected: edit as unknown as Record<string, unknown>, userName: displayName || null,
      } });
      setSavedId(r.id); toast.success("Étape pneu enregistrée");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Enregistrement impossible."); } finally { setBusy(false); }
  }

  function reset() {
    if (result && !savedId && !confirm("Abandonner l'analyse non enregistrée ?")) return;
    setImages([]); setResult(null); setEdit(null); setError(""); setSavedId(null); setRole("tread");
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

  return (
    <AppShell title="Étape pneu" subtitle="Flanc, usure et profil de la bande de roulement" back={{ to: "/atelier" }}>
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
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => cam.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-brand px-3 py-4 text-sm font-extrabold uppercase text-brand-foreground">
              <Camera className="h-5 w-5" /> Caméra
            </button>
            <button type="button" onClick={() => imp.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border-2 border-border px-3 py-4 text-sm font-extrabold uppercase">
              <ImagePlus className="h-5 w-5" /> Importer
            </button>
          </div>
          {/* Inputs gardés dans le DOM (sr-only) : indispensable pour iPhone/Safari. */}
          <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Prendre une photo" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={imp} type="file" accept="image/*" multiple className="sr-only" aria-label="Importer des photos" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <p className="text-xs text-muted-foreground">Prochaine photo : <b>{ROLE_LABEL[role]}</b>. Minimum conseillé : une bande de roulement + un flanc (6 photos max, même pneu).</p>
          {images.length ? (
            <div className="grid grid-cols-3 gap-2">
              {images.map((im, i) => (
                <div key={i} className="relative overflow-hidden rounded-lg border-2 border-border">
                  <img src={im.dataUrl} alt={ROLE_LABEL[im.role]} className="aspect-square w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-background/85 px-1 py-0.5 text-[10px] font-bold uppercase">{ROLE_LABEL[im.role]}</div>
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
          {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
        </section>

        {edit && sw && d && w ? (
          <>
            <section className="card-surface space-y-3 p-4">
              <h2 className="text-sm font-extrabold uppercase">Profil d'usure</h2>
              <div className="flex items-start gap-2 rounded-lg border-2 border-warning bg-warning/10 px-3 py-2 text-xs font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> {EXPERIMENTAL_DEPTH_NOTICE}
              </div>
              <TireWearProfile points={d.points_mm} />
              <div className="grid grid-cols-3 gap-2">
                {([["inner_mm", "Intérieur"], ["center_mm", "Centre"], ["outer_mm", "Extérieur"]] as const).map(([k, l]) => {
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
              {isAsymmetric(d) ? <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm font-bold">Usure dissymétrique : écart intérieur / extérieur important.</p> : null}
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
