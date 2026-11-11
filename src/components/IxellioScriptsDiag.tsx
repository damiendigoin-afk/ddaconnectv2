/** Rendu assaini de la chaîne JS IXELLIO (section K) + bouton manager « Inspecter scripts IXELLIO ». */
import { useServerFn } from "@tanstack/react-start";
import { FileCode } from "lucide-react";
import { useRef, useState } from "react";

import { CopyDiagButton } from "@/components/IxellioLaborDiag";
import { VERIFIED_ROLES, type JsFlow } from "@/lib/ixellio-js-flow";
import { inspectIxellioPublicScriptsDiag, inspectIxellioScriptsDiag } from "@/lib/ixellio.functions";

const ep = (e: { path: string; method: string | null }) => `${e.path}${e.method ? `?method=${e.method}` : ""}`;

export function FlowView({ flow }: { flow: JsFlow }) {
  return (
    <>
      {flow.functions.map((f) => (
        <div key={f.name} className="pl-2">
          <span className="font-bold">{f.name}</span>{VERIFIED_ROLES[f.name] ? ` [${VERIFIED_ROLES[f.name]}]` : ""} · {f.exists ? `définie (${f.parse})` : "absente"}
          {f.exists ? ` · paramètres : ${f.params.join(", ") || "—"} · appelle : ${f.calls.join(", ") || "—"} · réseau : ${f.ajax.map((a) => `${a.fn} ${a.method}`).join(", ") || "aucun"} · adresses : ${f.endpoints.map(ep).join(", ") || "—"} · DOM : ${f.domShapes.join(", ") || "—"} · cases à cocher : ${f.buildsCheckboxes ? "oui" : "non"} · interventions : ${f.interventionList ? "oui" : "non"} · « min » littéral : ${f.minuteUnitExplicit ? "oui" : "non"} · effet : ${f.outcomes.join(", ") || "—"} · champs formulaire : ${f.formFields?.join(", ") || "—"} · action envoyée : ${f.submitMethods?.join(", ") || "—"} · envoi : ${f.submits ? "OUI (écriture/navigation)" : "non"} · temps/durée cité : ${f.timeRefs ? "oui" : "non"}` : ""}
        </div>
      ))}
      <div>Bouton OK → {flow.okHandlers.join(", ") || "non déterminé"} · globales : {flow.globals.join(", ") || "—"}</div>
      <div>Fonctions déclarées : {flow.declared} · OK → saveSelectionToChiffrage : {flow.okCallsSave} · saveSelectionToChiffrage modifie le chiffrage : {flow.saveIsMutating}</div>
      {flow.warnings.map((w, i) => <div key={i} className="text-muted-foreground">⚠ {w}</div>)}
    </>
  );
}

export const AUTH_FAILED_SCRIPTS_MSG =
  "Échec de la connexion initiale IXELLIO : aucun fichier JS consulté. Ne pas relancer en boucle ; vérifier la session IXELLIO et les identifiants une seule fois plus tard.";

type ScriptsRes = Awaited<ReturnType<typeof inspectIxellioScriptsDiag>> | (Awaited<ReturnType<typeof inspectIxellioPublicScriptsDiag>>);

export function IxellioScriptsDiag() {
  const runAuth = useServerFn(inspectIxellioScriptsDiag);
  const runPublic = useServerFn(inspectIxellioPublicScriptsDiag);
  const [loading, setLoading] = useState<"auth" | "public" | null>(null);
  const [mode, setMode] = useState<"auth" | "public">("public");
  const [res, setRes] = useState<ScriptsRes | null>(null);
  const [error, setError] = useState("");
  const reportRef = useRef<HTMLDivElement>(null);
  async function submit(m: "auth" | "public") {
    setLoading(m); setMode(m); setError(""); setRes(null);
    try { setRes(m === "public" ? await runPublic() : await runAuth()); } catch (e) { setError(e instanceof Error ? e.message : "Erreur inconnue"); } finally { setLoading(null); }
  }
  const label = mode === "public" ? "Scripts IXELLIO publics (sans connexion)" : "Scripts IXELLIO — chaîne Remplacer / temps (avec connexion)";
  return (
    <div className="mt-4 rounded-lg border border-border px-3 py-3">
      <div className="flex items-center gap-2 text-[11px] font-bold text-brand"><FileCode className="h-4 w-4" /> Scripts IXELLIO — chaîne Remplacer / temps</div>
      <div className="text-xs text-muted-foreground">Une connexion puis deux lectures fixes : /scripts/pieceRecherche.js et /scripts/intervention.js. Aucun clic, aucun envoi, rien enregistré.</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit("public")} disabled={loading !== null} className="rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60">
          {loading === "public" ? "Inspection…" : "Inspecter les scripts publics (sans connexion)"}
        </button>
        <button type="button" onClick={() => void submit("auth")} disabled={loading !== null} className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-extrabold uppercase disabled:opacity-60">
          {loading === "auth" ? "Inspection…" : "Inspecter scripts IXELLIO"}
        </button>
      </div>
      <div className="text-[11px] text-muted-foreground">Sans connexion : aucun identifiant ni cookie envoyé ; si IXELLIO refuse, rien d'autre n'est tenté.</div>
      {error ? <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {res ? <CopyDiagButton target={reportRef} label={label} /> : null}
      {res ? (
        <div ref={reportRef} className="mt-2 space-y-2 text-xs">
          <div className="rounded-lg bg-muted px-3 py-2 font-bold">{res.status} — {res.status === "auth_failed" ? AUTH_FAILED_SCRIPTS_MSG : res.message} ({res.durationMs} ms){"loginUsed" in res ? " · aucune connexion utilisée" : ""}</div>
          {res.files.map((f) => (
            <div key={f.path} className="rounded-lg border border-border px-3 py-2">
              <div className="font-bold">{f.path} · HTTP {f.status ?? "—"} · {f.bytes} octets · {f.outcome} · source du temps visible : {f.timeSourceVisible ? "oui" : "non"}</div>
              {f.outcome === "analysé" ? (
                <>
                  <div>Mots-clés : {f.keywords.filter((k) => k.count).map((k) => `${k.word} ×${k.count}`).join(", ") || "aucun"}</div>
                  <div>Fonctions liées : {f.functions.join(", ") || "—"}</div>
                  <div>Adresses internes : {f.endpoints.map(ep).join(", ") || "—"}</div>
                  {f.flow ? <FlowView flow={f.flow} /> : null}
                </>
              ) : null}
            </div>
          ))}
          <ol className="rounded-lg bg-muted px-3 py-2 font-mono text-[10px] text-muted-foreground">{res.trace.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </div>
      ) : null}
    </div>
  );
}
