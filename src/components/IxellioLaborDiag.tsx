import { useServerFn } from "@tanstack/react-start";
import { Clock } from "lucide-react";
import { useState } from "react";
import { inspectIxellioLaborDiag } from "@/lib/ixellio.functions";
import type { MenuCategory } from "@/lib/ixellio-labor-parse";

type Res = Awaited<ReturnType<typeof inspectIxellioLaborDiag>>;
const CAT: Record<MenuCategory, string> = {
  temps_bareme: "Temps barémés / MO", chiffrage: "Chiffrage", pieces: "Pièces", vehicule: "Véhicule", documentation: "Documentation", autre: "Autres",
};
const ORDER: MenuCategory[] = ["temps_bareme", "chiffrage", "vehicule", "documentation", "pieces", "autre"];

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
          <div className="text-[11px] font-bold text-brand">Diagnostic TM v1 — inspection du menu</div>
          <div className="text-xs text-muted-foreground">
            Lecture seule : une connexion, analyse du menu principal uniquement, aucune page de temps consultée. Peut déconnecter une session IXELLIO ouverte ailleurs.
          </div>
        </div>
      </div>
      <button onClick={() => void submit()} disabled={loading}
        className="mt-3 rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60">
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
