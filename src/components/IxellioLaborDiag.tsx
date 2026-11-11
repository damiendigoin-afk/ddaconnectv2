import { useServerFn } from "@tanstack/react-start";
import { Clock } from "lucide-react";
import { useState } from "react";
import { inspectIxellioLaborDiag, inspectIxellioTempsPageDiag } from "@/lib/ixellio.functions";
import type { MenuCategory } from "@/lib/ixellio-labor-parse";

type Res = Awaited<ReturnType<typeof inspectIxellioLaborDiag>>;
const CAT: Record<MenuCategory, string> = {
  temps_bareme: "Temps barémés / MO", forfaits: "Forfaits", chiffrage: "Chiffrage", pieces: "Pièces", vehicule: "Véhicule", documentation: "Documentation", autre: "Autres",
};
const ORDER: MenuCategory[] = ["temps_bareme", "forfaits", "chiffrage", "vehicule", "documentation", "pieces", "autre"];

type PageRes = Awaited<ReturnType<typeof inspectIxellioTempsPageDiag>>;

function TempsPageDiag() {
  const run = useServerFn(inspectIxellioTempsPageDiag);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<PageRes | null>(null);
  const [error, setError] = useState("");
  async function submit() {
    setLoading(true); setError(""); setRes(null);
    try { setRes(await run()); } catch (e) { setError(e instanceof Error ? e.message : "Erreur inconnue"); } finally { setLoading(false); }
  }
  const p = res?.page;
  return (
    <div className="mt-3 rounded-lg border border-border px-3 py-3">
      <div className="text-[11px] font-bold text-brand">Diagnostic TM v2 — inspection page Temps</div>
      <div className="text-xs text-muted-foreground">Une connexion puis une seule lecture de la page « Temps » d'IXELLIO. Aucun formulaire envoyé, aucune recherche lancée.</div>
      <button onClick={() => void submit()} disabled={loading}
        className="mt-2 rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60">
        {loading ? "Inspection…" : "Inspecter page Temps"}
      </button>
      {error ? <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {res ? (
        <div className="mt-2 space-y-2 text-xs">
          <div className="rounded-lg bg-muted px-3 py-2 font-bold">{res.status} — {res.message} ({res.durationMs} ms)</div>
          <div className="text-[11px] text-muted-foreground">
            GET {res.getStatus ?? "—"}{res.redirectKind ? ` · redirection ${res.redirectKind}` : ""} · {res.bytes} octets · TM extraits : non
          </div>
          {p ? (
            <>
              <div>Titre « {p.title || "—"} » · {p.tableCount} tableau(x) · nécessite un véhicule : {p.needsVehicle ? "oui (indice champ)" : "non établi"} · nécessite une opération : {p.needsOperation ? "oui (indice champ)" : "non établi"}</div>
              <div className="rounded bg-muted px-2 py-1">
                Tableau de temps explicite (opération + unité) : {p.explicitTimeRows ? `${p.explicitTimeRows} ligne(s) détectée(s), non affichées (liaison véhicule/opération non établie)` : "aucun"}
                {p.timeHeaderWithoutUnit ? " · colonne temps sans unité déclarée" : ""}
              </div>
              {p.limitations.length ? <div className="text-destructive">Limites : {p.limitations.join(" · ")}</div> : null}
              <div className="font-bold">A. Formulaires ({p.forms.length})</div>
              {p.forms.map((f, i) => (
                <div key={i} className="break-all pl-2">{f.httpMethod} {f.path} · champs : {f.fields.map((x) => `${x.name} (${x.type})`).join(", ") || "—"}</div>
              ))}
              <div className="font-bold">B. Champs de recherche ({p.searchFields.length})</div>
              {p.searchFields.map((f, i) => <div key={i} className="pl-2">{f.name} ({f.type}) · {f.hint}</div>)}
              <div className="font-bold">C. Intitulés ({p.headings.length})</div>
              <div className="pl-2">{p.headings.join(" · ") || "—"}</div>
              <div className="font-bold">D. Liens et actions internes ({p.links.length})</div>
              {p.links.map((e, i) => (
                <div key={i} className="break-all pl-2">« {e.label} » · {e.httpMethod} {e.path}{e.paramNames.length ? ` · paramètres : ${e.paramNames.join(", ")}` : ""} · {e.via} · {CAT[e.category]}</div>
              ))}
            </>
          ) : null}
          <details className="text-[11px] text-muted-foreground"><summary>Trace</summary>{res.trace.map((t, i) => <div key={i}>{t}</div>)}</details>
        </div>
      ) : null}
    </div>
  );
}

export function IxellioLaborDiag() {
  const run = useServerFn(inspectIxellioLaborDiag);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const [error, setError] = useState("");
  async function submit() {
    setLoading(true); setError(""); setRes(null);
    try { setRes(await run()); } catch (e) { setError(e instanceof Error ? e.message : "Erreur inconnue"); } finally { setLoading(false); }
  }
  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card px-4 py-4">
      <div className="flex items-center gap-3">
        <Clock className="h-6 w-6 shrink-0 text-brand" />
        <div>
          <div className="text-base font-extrabold uppercase tracking-wide">IXELLIO — temps barémés · diagnostic</div>
          <div className="text-[11px] font-bold text-brand">Diagnostic TM v2 — inspection page Temps</div>
          <div className="text-xs text-muted-foreground">
            Lecture seule : une connexion, analyse du menu principal uniquement, aucune page de temps consultée. Peut déconnecter une session IXELLIO ouverte ailleurs.
          </div>
        </div>
      </div>
      <TempsPageDiag />
      <div className="mt-3 text-[11px] text-muted-foreground">TM v1 — inspection du menu (secondaire) :</div>
      <button onClick={() => void submit()} disabled={loading}
        className="mt-1 rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60">
        {loading ? "Inspection…" : "Inspecter accès aux TM"}
      </button>
      {error ? <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {res ? (
        <div className="mt-3 space-y-2 text-xs">
          <div className="rounded-lg bg-muted px-3 py-2 font-bold">{res.status} — {res.message} ({res.durationMs} ms)</div>
          <div className="text-[11px] text-muted-foreground">
            Menu atteint : {res.reachedMain ? "oui" : "non"} · {res.bytes} octets · statut TM : {res.laborStatus} · temps récupérés : 0
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground">
            Aucun temps barémé n'est affiché à cette étape. « Redressage / Réparation / Peinture | Temps » relèvent du chiffrage carrosserie, pas des temps constructeur mécaniques.
          </p>
          {res.menu?.limitations.length ? (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
              Limites signalées : {res.menu.limitations.join(" · ")}
            </div>
          ) : null}
          {res.menu ? (
            <>
              <div className="font-bold">A. Entrées du menu ({res.menu.entries.length}) · titre « {res.menu.title || "—"} »</div>
              {ORDER.map((c) => {
                const list = res.menu!.entries.filter((e) => e.category === c);
                if (!list.length) return null;
                return (
                  <div key={c} className="rounded bg-muted px-2 py-1">
                    <div className="font-bold">{CAT[c]} ({list.length})</div>
                    {list.map((e, i) => (
                      <div key={i} className="break-all pl-2">
                        « {e.label} » · {e.httpMethod} {e.path}
                        {e.paramNames.length ? ` · paramètres : ${e.paramNames.join(", ")}` : ""} · {e.via}
                        {e.needsVehicle ? " · nécessite un véhicule" : ""}{e.needsOperation ? " · nécessite une opération" : ""}
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="font-bold">B. Formulaires ({res.menu.forms.length})</div>
              {res.menu.forms.map((f, i) => (
                <div key={i} className="break-all pl-2">
                  {f.httpMethod} {f.path} · champs : {f.fields.map((x) => `${x.name} (${x.type})`).join(", ") || "—"}
                </div>
              ))}
            </>
          ) : null}
          <details className="text-[11px] text-muted-foreground">
            <summary>Trace</summary>
            {res.trace.map((t, i) => <div key={i}>{t}</div>)}
          </details>
        </div>
      ) : null}
    </div>
  );
}
