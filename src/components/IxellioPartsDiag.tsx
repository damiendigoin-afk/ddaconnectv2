/** Consultation catalogue IXELLIO par référence — diagnostic manager, lecture seule. */
import { useServerFn } from "@tanstack/react-start";
import { IXELLIO_TARIFF_LABEL } from "@/lib/ixellio-tariff";
import { reconcileCandidates } from "@/lib/ixellio-parts-reconcile";
import { Check, Copy, Search } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { blockText, copyText } from "@/lib/copy-text.browser";
import { FlowView, IxellioScriptsDiag } from "@/components/IxellioScriptsDiag";

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
  const reportRef = useRef<HTMLDivElement>(null);
  const sectionIRef = useRef<HTMLDivElement>(null);
  const sectionJRef = useRef<HTMLDivElement>(null);
  const sectionKRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"all" | "i" | "j" | "k" | null>(null);

  async function copy(kind: "all" | "i" | "j" | "k") {
    const body = blockText(kind === "all" ? reportRef.current : kind === "i" ? sectionIRef.current : kind === "j" ? sectionJRef.current : sectionKRef.current);
    const ok = body ? await copyText(`Référence recherchée : ${ref.trim().toUpperCase()}\nStatut : ${res?.status ?? "—"}\n${body}`) : false;
    if (ok) {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
      toast.success(kind === "all" ? "Diagnostic copié" : kind === "i" ? "Section I copiée" : kind === "j" ? "Section J copiée" : "Section K copiée");
    } else toast.error("Copie impossible — sélectionnez le texte manuellement.");
  }

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
          <div className="text-[11px] font-bold text-brand">IXELLIO v10 — Chaîne sélection → Remplacer → temps</div>
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy("all")} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold">
            {copied === "all" ? <Check className="h-4 w-4 text-brand" /> : <Copy className="h-4 w-4" />} Copier le diagnostic
          </button>
          {res.diagnostic.repair ? (
            <button type="button" onClick={() => void copy("i")} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold">
              {copied === "i" ? <Check className="h-4 w-4 text-brand" /> : <Copy className="h-4 w-4" />} Copier la section I
            </button>
          ) : null}
          {res.diagnostic.selection ? (
            <button type="button" onClick={() => void copy("j")} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold">
              {copied === "j" ? <Check className="h-4 w-4 text-brand" /> : <Copy className="h-4 w-4" />} Copier la section J
            </button>
          ) : null}
          {res.diagnostic.selection?.flow ? (
            <button type="button" onClick={() => void copy("k")} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-bold">
              {copied === "k" ? <Check className="h-4 w-4 text-brand" /> : <Copy className="h-4 w-4" />} Copier la section K
            </button>
          ) : null}
        </div>
      ) : null}
      {res ? (
        <div ref={reportRef} className="mt-3 space-y-2 text-xs">
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
              {res.diagnostic.euros.candidates?.length ? (() => {
                const cands = res.diagnostic.euros.candidates;
                const rec = reconcileCandidates(res.status, res.result?.parts, res.diagnostic.grouping?.results, cands);
                if (rec.allCovered) return (
                  <div className="my-1 rounded bg-muted px-2 py-1">
                    <div className="font-bold">Inventaire des montants (détails techniques) : {cands.length} ligne(s) catalogue, {res.diagnostic.euros.distinctAmounts} montant(s) distinct(s)</div>
                    <div className="text-muted-foreground">Toutes correspondent (désignation et montant) aux résultats validés en section F. Ce relevé brut ne valide à lui seul aucun lien ; une ligne catalogue n'est pas forcément une pièce physique distincte.</div>
                  </div>
                );
                return (
                <div className="my-1 rounded bg-muted px-2 py-1">
                  <div className="font-bold">
                    Lignes catalogue détectées — candidats non validés : {cands.length} ligne(s),{" "}
                    {res.diagnostic.euros.distinctAmounts} montant(s) distinct(s)
                  </div>
                  <div className="text-muted-foreground">
                    Non rattachées à la référence cherchée · montants : {IXELLIO_TARIFF_LABEL} (déclaration du gérant).
                  </div>
                  {cands.map((c, i) => (
                    <div key={i}>
                      {c.label} — {c.amount.toFixed(2)} €{c.occurrences > 1 ? ` (×${c.occurrences})` : ""} · {rec.covered[i] ? "correspond à un résultat validé (F)" : "association non vérifiée"}
                      {c.commonAncestor
                        ? ` · ancêtre commun tableau ${c.commonAncestor.tableIndex} (${c.commonAncestor.candidatesInside} candidat(s), ${c.commonAncestor.referenceAnchorsInside} ancre(s) Référence)`
                        : " · aucun ancêtre commun avec Référence"}
                    </div>
                  ))}
                </div>
                );
              })() : null}
              {res.diagnostic.euros.items.map((e, i) => (
                <div key={i}>
                  {e.amount.toFixed(2)} € · « {e.cellText || "—"} »{e.rowLabel ? ` · ligne « ${e.rowLabel} »` : ""} · tableau{" "}
                  {e.tableIndex ?? "—"} prof. {e.tableDepth} case {e.cellIndex ?? "—"} · Référence{" "}
                  {e.referenceLevelsUp == null ? "aucune" : `${e.referenceLevelsUp} niveau(x) au-dessus`} · {reconcileCandidates(res.status, res.result?.parts, res.diagnostic.grouping?.results, res.diagnostic.euros?.candidates ?? []).allCovered ? "position brute (lien validé en F)" : e.association}
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
              {res.diagnostic.grouping.categoryProbes?.length ? (
                <div className="my-1 rounded bg-muted px-2 py-1">
                  <div className="font-bold">G. Tables précédant chaque montant (catégorie)</div>
                  {res.diagnostic.grouping.categoryProbes.map((g, i) => (
                    <div key={i}>
                      <div>{g.designation} :</div>
                      {g.probes.map((p, j) => (
                        <div key={j} className="pl-2">
                          tableau {p.tableIndex} · « {p.label || "—"} » · {p.rows}×{p.cells} · cellules {p.cells} / renseignées {p.filledCells ?? "?"} · prof. {p.depth} · {p.inExclusiveBlock ? "même bloc" : "hors bloc"} · {p.verdict}
                        </div>
                      ))}
                      {!g.probes.length ? <div className="pl-2">aucune table précédente</div> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="font-bold">Conversion en devis : bloquée — {res.diagnostic.grouping.quoteConversionReason}</div>
            </div>
          ) : null}
          {res.diagnostic.replace ? (() => {
            const h = res.diagnostic.replace;
            const ep = (e: { path: string; method: string | null }) => `${e.path}${e.method ? `?method=${e.method}` : ""}`;
            return (
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="font-bold">H. Option « Remplacer » / temps — {h.controls.length} contrôle(s), {h.otherCheckboxes} autre(s) case(s), texte « remplac » ×{h.remplacerTextOccurrences}</div>
                {h.controls.map((c) => (
                  <div key={c.index} className="pl-2">
                    #{c.index} {c.designation ?? "carte ?"} ({c.designationSource}) · {c.tag}{c.type ? `/${c.type}` : ""} « {c.label || "—"} » · coché par défaut : {c.checkedDefault == null ? "n/a" : c.checkedDefault ? "oui" : "non"}{c.disabled ? " · désactivé" : ""} · nom : {c.nameShape ?? "—"} · attributs : {c.attrNames.join(", ") || "—"} · formulaire : {c.form ? `${c.form.method} ${c.form.action ? ep(c.form.action) : "—"}` : "aucun"} · gestionnaires : {c.handlers.map((x) => `${x.event} → ${x.functions.join("/") || "?"}${x.endpoints.length ? ` [${x.endpoints.map(ep).join(", ")}]` : ""}`).join(" ; ") || "aucun"}
                  </div>
                ))}
                <div>Scripts : {h.scripts.count} · mention « remplac » : {h.scripts.mentionsRemplac ? "oui" : "non"} · fonctions : {h.scripts.functions.join(", ") || "—"} · adresses : {h.scripts.endpoints.map(ep).join(", ") || "—"}</div>
                <div>Lignes de temps :</div>
                {h.timeRows.map((t, i) => (
                  <div key={i} className="pl-2">{t.label} · cellules {t.cells} / renseignées {t.filledCells} · nombre présent : {t.numericPresent ? "oui" : "non"} · unité : {t.unit}{t.inputs.length ? ` · champs : ${t.inputs.map((x) => `${x.type}${x.nameShape ? ` ${x.nameShape}` : ""}`).join(", ")}` : ""}</div>
                ))}
                {!h.timeRows.length ? <div className="pl-2">—</div> : null}
                {h.warnings.map((w, i) => <div key={i} className="text-muted-foreground">⚠ {w}</div>)}
              </div>
            );
          })() : null}
          {res.diagnostic.selection ? (() => {
            const j = res.diagnostic.selection;
            const ep = (e: { path: string; method: string | null }) => `${e.path}${e.method ? `?method=${e.method}` : ""}`;
            return (
              <div ref={sectionJRef} className="rounded-lg border border-border px-3 py-2">
                <div className="font-bold">J. Sélection pièce → popup interventions — {j.verdict}</div>
                {j.rows.map((r) => (
                  <div key={r.resultIndex} className="pl-2">
                    #{r.resultIndex} {r.category ?? "catégorie ?"} · {r.designation} · rattachement {r.mapping} ({r.mappingReason}) · clic : {r.bindings.map((b) => `${b.level} ${b.event} → ${b.functions.join("/") || "?"}${b.endpoints.length ? ` [${b.endpoints.map(ep).join(", ")}]` : ""}`).join(" ; ") || "aucun inline"} · role : {r.roles.join(", ") || "—"} · classes : {r.classHints.join(", ") || "—"} · curseur main : {r.pointerCursor ? "oui" : "non"} · cases : {r.checkboxesInRow}
                  </div>
                ))}
                <div>Scripts inline : {j.scripts.inline} · mots-clés : {j.scripts.keywords.filter((k) => k.count).map((k) => `${k.word} ×${k.count}`).join(", ") || "aucun"}</div>
                <div>Fonctions (sélection/popup/chiffrage) : {j.scripts.functions.join(", ") || "—"}</div>
                <div>Adresses internes : {j.scripts.endpoints.map(ep).join(", ") || "—"} · liaisons de clic par script : {j.scripts.delegatedClickBindings}</div>
                <div>Fichiers JS externes : {j.scripts.external.join(", ") || "aucun"}</div>
                {j.warnings.map((w, i) => <div key={i} className="text-muted-foreground">⚠ {w}</div>)}
              </div>
            );
          })() : null}
          {res.diagnostic.selection?.flow ? (
            <div ref={sectionKRef} className="rounded-lg border border-border px-3 py-2">
              <div className="font-bold">K. Chaîne de sélection → fenêtre Remplacer → temps (scripts inline)</div>
              <FlowView flow={res.diagnostic.selection.flow} />
            </div>
          ) : null}
          {res.diagnostic.repair ? (() => {
            const r = res.diagnostic.repair;
            const ep = (e: { path: string; method: string | null }) => `${e.path}${e.method ? `?method=${e.method}` : ""}`;
            const yn = (b: boolean) => (b ? "oui" : "non");
            return (
              <div ref={sectionIRef} className="rounded-lg border border-border px-3 py-2">
                <div className="font-bold">I. Lignes « Réparation » — {r.rows.length} ligne(s) · valeurs jamais affichées</div>
                {r.rows.map((row) => (
                  <div key={row.index} className="mt-1 pl-2">
                    <div>#{row.index} · rattachement {row.mapping.status}{row.mapping.status === "vérifiée" ? ` → résultat ${row.mapping.resultIndex} ${row.mapping.category ?? "catégorie ?"} · ${row.mapping.designation}` : ""} ({row.mapping.reason})</div>
                    <div>cellules {row.cells} / renseignées {row.filledCells} · nombre dans le texte : {yn(row.numericInText)} · unité : {row.unit} · lignes voisines : {row.adjacentRows.join(" / ") || "—"}</div>
                    {row.controls.map((c, j) => (
                      <div key={j} className="pl-2">
                        {c.tag}/{c.type} · nom : {c.nameShape ?? "—"} · indice : {c.hintCategory} · valeur présente : {yn(c.valuePresent)}{c.valuePresent ? ` (numérique : ${yn(c.valueNumeric)})` : ""}
                        {c.options ? ` · options ${c.options.count}${c.options.truncated ? "+" : ""} : ${c.options.labels.join(" | ") || "—"} · sélection : ${c.options.selectedLabel ?? "—"}` : ""}
                        {c.handlers.length ? ` · gestionnaires : ${c.handlers.map((x) => `${x.event} → ${x.functions.join("/") || "?"}${x.endpoints.length ? ` [${x.endpoints.map(ep).join(", ")}]` : ""}`).join(" ; ")}` : ""}
                        {` · attributs : ${c.attrNames.join(", ") || "—"}`}
                      </div>
                    ))}
                    <div className="pl-2">Options : Remplacer {yn(row.optionFlags.remplacer)} · Remplacement {yn(row.optionFlags.remplacement)} · T1/T2/T3 {yn(row.optionFlags.t1t2t3)} · Réparation {yn(row.optionFlags.reparation)} · Temps {yn(row.optionFlags.temps)}</div>
                    <div className="pl-2">Cases personnalisées (ligne + voisines) : role=checkbox {row.customCheckbox.roleCheckbox} · aria-checked {row.customCheckbox.ariaChecked} · data-* {row.customCheckbox.dataAttrNames.join(", ") || "—"} · classes {row.customCheckbox.classHints.join(", ") || "—"}</div>
                  </div>
                ))}
                <div className="mt-1">Hors lignes Réparation : texte « remplac » ×{r.outside.remplacTextOccurrences} · attributs ×{r.outside.remplacInAttributes} · options ×{r.outside.remplacInOptions} · cases {r.outside.checkboxInputs} · role=checkbox {r.outside.roleCheckbox} · aria-checked {r.outside.ariaChecked} · classes {r.outside.classHints.join(", ") || "—"}</div>
                <div className="text-muted-foreground">T1/T2/T3 = catégories de MO, pas des durées.</div>
                {r.warnings.map((w, i) => <div key={i} className="text-muted-foreground">⚠ {w}</div>)}
              </div>
            );
          })() : null}
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
      <IxellioScriptsDiag />
    </div>
  );
}
