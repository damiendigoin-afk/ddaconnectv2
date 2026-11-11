/** Consultation catalogue IXELLIO par référence — diagnostic manager, lecture seule. */
import { useServerFn } from "@tanstack/react-start";
import { IXELLIO_TARIFF_LABEL } from "@/lib/ixellio-tariff";
import { Search } from "lucide-react";
import { useState } from "react";

import { Field } from "@/components/bits";
import { lookupIxellioPartsDiag } from "@/lib/ixellio.functions";

type Res = Awaited<ReturnType<typeof lookupIxellioPartsDiag>>;

const fmt = (v: string | null | undefined) => v ?? "—";

export function IxellioPartsDiag() {
  const run = useServerFn(lookupIxellioPartsDiag);
  const [ref, setRef] = useState("214992066R");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Res | null>(null);
  const [error, setError] = useState("");

  async function submit() {
    setLoading(true);
    setError("");
    setRes(null);
    try {
      setRes(await run({ data: { reference: ref } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-card px-4 py-4">
      <div className="flex items-center gap-3">
        <Search className="h-6 w-6 shrink-0 text-brand" />
        <div>
          <div className="text-base font-extrabold uppercase tracking-wide">Catalogue IXELLIO · diagnostic</div>
          <div className="text-[11px] font-bold text-brand">Diagnostic IXELLIO v4 — contrôle des catégories</div>
          <div className="text-xs text-muted-foreground">
            Lecture seule, une consultation à la fois. Peut déconnecter une session IXELLIO ouverte ailleurs.
          </div>
        </div>
      </div>
      <div className="mt-3">
        <Field label="Référence constructeur" value={ref} onChange={setRef} placeholder="214992066R" />
      </div>
      <button
        onClick={() => void submit()}
        disabled={loading || ref.replace(/[^A-Za-z0-9]/g, "").length < 4}
        className="mt-3 rounded-lg bg-brand px-3 py-2 text-xs font-extrabold uppercase text-brand-foreground disabled:opacity-60"
      >
        {loading ? "Consultation…" : "Consulter IXELLIO"}
      </button>
      {error ? <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {res ? (
        <div className="mt-3 space-y-2 text-xs">
          <div className="rounded-lg bg-muted px-3 py-2 font-bold">
            {res.status} — {res.message} ({res.durationMs} ms)
          </div>
          <div className="text-[11px] text-muted-foreground">
            HTTP {res.diagnostic.searchStatus ?? "—"} · {res.diagnostic.bytes} octets · CSRF{" "}
            {res.diagnostic.csrfFound ? "oui" : "non"} · champs : {res.diagnostic.formFieldNames.join(", ") || "—"}
            {res.diagnostic.headers.length ? ` · en-têtes : ${res.diagnostic.headers.map((h) => h.join(" | ")).join(" / ")}` : ""}
          </div>
          {res.status === "structure_non_reconnue" ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 font-bold text-destructive">
              Recherche non validée : IXELLIO a répondu, mais aucune ligne n'a pu être lue.
            </p>
          ) : null}
          {res.diagnostic.pageForms?.length ? (
            <div className="rounded-lg border border-border px-3 py-2 text-[11px]">
              <div className="font-bold">Formulaires de la page de recherche</div>
              {res.diagnostic.pageForms.map((f, i) => (
                <div key={i} className="mt-1">
                  #{i + 1} {f.httpMethod} {f.action ?? "(sans action)"} — {f.fields.map((x) => `${x.name}:${x.type}${x.options != null ? `(${x.options} opt.)` : ""}`).join(", ") || "aucun champ"}
                </div>
              ))}
            </div>
          ) : null}
          {res.diagnostic.response ? (
            <div className="rounded-lg border border-border px-3 py-2 text-[11px]">
              <div className="font-bold">Structure de la réponse</div>
              <div>Titre : {fmt(res.diagnostic.response.title)} · Titres : {res.diagnostic.response.headings.join(" / ") || "—"}</div>
              <div>Messages : {res.diagnostic.response.messages.join(" / ") || "—"}</div>
              <div>
                Référence présente : {res.diagnostic.response.referencePresent ? `oui (${res.diagnostic.response.referenceOccurrences})` : "non"}
              </div>
              <div>Blocs répétés : {res.diagnostic.response.repeatedBlocks.map((b) => `${b.cls}×${b.count}`).join(", ") || "—"}</div>
              <div>Indices script : {res.diagnostic.response.scriptEndpoints.join(", ") || "—"}</div>
              {res.diagnostic.response.tables.map((t, i) => (
                <div key={i} className="mt-1">
                  Tableau {i + 1}{t.nested ? " (imbriqué)" : ""} : {t.rows}×{t.cols} — {t.headerRows.map((r) => r.join(" | ")).join(" // ") || "—"}
                </div>
              ))}
            </div>
          ) : null}
          {res.diagnostic.pageHints ? (
            <div className="rounded-lg border border-border px-3 py-2 text-[11px]">
              <div className="font-bold">A. Indices du formulaire (page de recherche)</div>
              <div>Balises form : {res.diagnostic.pageHints.formOpen} ouvertes / {res.diagnostic.pageHints.formClose} fermées</div>
              <div>Champs hors formulaire : {res.diagnostic.pageHints.looseFields.map((f) => `${f.name}:${f.type}`).join(", ") || "—"}</div>
              <div>Cibles de soumission : {res.diagnostic.pageHints.submitTargets.join(", ") || "—"}</div>
            </div>
          ) : null}
          {res.diagnostic.targeted ? (
            <div className="rounded-lg border border-border px-3 py-2 text-[11px]">
              <div className="font-bold">B. Ancres « Référence : »</div>
              {res.diagnostic.targeted.referenceAnchors.map((a, i) => (
                <div key={i}>
                  #{i + 1} profondeur {a.depth} · {a.rows}×{a.cols} · prix JS {a.prixToolCalls} — lignes : {a.rowLabels.join(" | ") || "—"}
                </div>
              ))}
              {!res.diagnostic.targeted.referenceAnchors.length ? <div>—</div> : null}
              <div className="mt-1 font-bold">C. createPrixStatusTool ({res.diagnostic.targeted.prixTool.count} appel(s))</div>
              {res.diagnostic.targeted.prixTool.samples.map((s, i) => (
                <div key={i}>
                  #{i + 1} {s.argCount} argument(s) : {s.argKinds.join(", ")}{s.objectKeys.length ? ` · clés : ${s.objectKeys.join(", ")}` : ""}
                </div>
              ))}
              <div className="mt-1 font-bold">D. Mentions « Prix » visibles</div>
              {res.diagnostic.targeted.priceCandidates.map((p, i) => (
                <div key={i}>
                  « {p.label} » : {p.amount != null ? p.amount.toFixed(2) : "montant inconnu"} [{p.basis === "unknown" ? "HT/TTC inconnu" : p.basis}]
                </div>
              ))}
              {!res.diagnostic.targeted.priceCandidates.length ? <div>—</div> : null}
            </div>
          ) : null}
          {res.diagnostic.euros ? (
            <div className="rounded-lg border border-border px-3 py-2 text-[11px]">
              <div className="font-bold">
                E. Montants en € visibles : {res.diagnostic.euros.total} ({res.diagnostic.euros.distinctAmounts} distinct(s))
              </div>
              <div className="text-muted-foreground">
                Montants IXELLIO : {IXELLIO_TARIFF_LABEL} — déclaration du gérant ; deux occurrences ne font pas forcément deux pièces.
              </div>
              {res.diagnostic.euros.candidates?.length ? (
                <div className="my-1 rounded bg-muted px-2 py-1">
                  <div className="font-bold">
                    Lignes catalogue détectées — candidats non validés : {res.diagnostic.euros.candidates.length} ligne(s),{" "}
                    {res.diagnostic.euros.distinctAmounts} montant(s) distinct(s)
                  </div>
                  <div className="text-muted-foreground">
                    Non rattachées à la référence cherchée · montants : {IXELLIO_TARIFF_LABEL} (déclaration du gérant).
                  </div>
                  {res.diagnostic.euros.candidates.map((c, i) => (
                    <div key={i}>
                      {c.label} — {c.amount.toFixed(2)} €{c.occurrences > 1 ? ` (×${c.occurrences})` : ""} · association non vérifiée
                      {c.commonAncestor
                        ? ` · ancêtre commun tableau ${c.commonAncestor.tableIndex} (${c.commonAncestor.candidatesInside} candidat(s), ${c.commonAncestor.referenceAnchorsInside} ancre(s) Référence)`
                        : " · aucun ancêtre commun avec Référence"}
                    </div>
                  ))}
                </div>
              ) : null}
              {res.diagnostic.euros.items.map((e, i) => (
                <div key={i}>
                  {e.amount.toFixed(2)} € · « {e.cellText || "—"} »{e.rowLabel ? ` · ligne « ${e.rowLabel} »` : ""} · tableau{" "}
                  {e.tableIndex ?? "—"} prof. {e.tableDepth} case {e.cellIndex ?? "—"} · Référence{" "}
                  {e.referenceLevelsUp == null ? "aucune" : `${e.referenceLevelsUp} niveau(x) au-dessus`} · {e.association}
                </div>
              ))}
            </div>
          ) : null}
          {res.diagnostic.grouping ? (
            <div className="rounded-lg border border-border px-3 py-2 text-[11px]">
              <div className="font-bold">
                F. Résultats groupés : {res.diagnostic.grouping.results.length} / annoncés {res.diagnostic.grouping.announced ?? "?"} · confiance {res.diagnostic.grouping.confidence} (groupement {res.diagnostic.grouping.groupingConfidence}, catégories {res.diagnostic.grouping.categoriesVerified}/{res.diagnostic.grouping.results.length})
              </div>
              <div className="text-muted-foreground">{res.diagnostic.grouping.confidenceReason}</div>
              {res.diagnostic.grouping.results.map((r) => (
                <div key={r.index}>
                  #{r.index} {r.categoryConfidence === "vérifiée" ? r.category : "⚠ catégorie non vérifiée"} · {r.designation} · Réf. {r.reference}{r.family ? ` · ${r.family}` : ""} · {r.priceDisplayed} ({IXELLIO_TARIFF_LABEL})
                </div>
              ))}
              {res.diagnostic.grouping.ungrouped.map((u, i) => (
                <div key={`u${i}`}>Non validé : {u.designation} · {u.priceDisplayed} — {u.reason}</div>
              ))}
              <div className="font-bold">Conversion en devis : bloquée — {res.diagnostic.grouping.quoteConversionReason}</div>
            </div>
          ) : null}
          {res.diagnostic.pageHints && res.diagnostic.pageHints.formOpen === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              Aucun formulaire dans la page de recherche : normal pour une page pilotée par JavaScript.
            </div>
          ) : null}
          {res.result?.parts.map((p, i) => (
            <div key={i} className="rounded-lg border border-border px-3 py-2">
              <div className="font-bold">
                {fmt(p.reference?.value)} {p.exactMatch ? "· correspondance exacte" : ""}
              </div>
              <div>Désignations : {p.designations.map((d) => d.value).join(" · ") || "—"}</div>
              <div>Marque : {fmt(p.brand?.value)} · Famille : {fmt(p.family?.value)}</div>
              <div>
                Prix :{" "}
                {p.prices.length
                  ? p.prices
                      .map(
                        (x) =>
                          `${x.amount.toFixed(2)} ${x.currency ?? ""} [${x.basis === "unknown" ? "HT/TTC non documenté" : x.basis}${
                            x.isPublic === true ? ", public" : ""
                          }] (« ${x.source} »)`,
                      )
                      .join(" · ")
                  : "—"}
              </div>
              {Object.keys(p.extra).length ? (
                <div className="text-muted-foreground">
                  {Object.entries(p.extra).map(([k, v]) => `${k} : ${v}`).join(" · ")}
                </div>
              ) : null}
              {p.detailLinks.length ? <div className="text-muted-foreground">Fiches : {p.detailLinks.join(", ")}</div> : null}
            </div>
          ))}
          <ol className="rounded-lg bg-muted px-3 py-2 font-mono text-[10px] text-muted-foreground">
            {res.trace.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
