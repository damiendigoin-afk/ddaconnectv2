/** Consultation catalogue IXELLIO par référence — diagnostic manager, lecture seule. */
import { useServerFn } from "@tanstack/react-start";
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
