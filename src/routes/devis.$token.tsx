import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/bits";
import { getPublicQuote, respondQuoteLine } from "@/lib/quote-client.functions";
import { BLOCK_LABEL, CONTACT_US, PRIORITY_LABEL, type Priority, type QuoteBlock } from "@/lib/pricing-engine";
import { RESPONSE_LABEL, type ClientResponse } from "@/lib/quotes";

export const Route = createFileRoute("/devis/$token")({
  head: () => ({
    meta: [
      { title: "Votre proposition d'intervention — DDA Connect" },
      {
        name: "description",
        content:
          "Détail des interventions proposées pour votre véhicule : acceptez, refusez ou reportez chaque ligne, le total se met à jour immédiatement.",
      },
      { property: "og:title", content: "Votre proposition d'intervention — DDA Connect" },
      { property: "og:description", content: "Répondez ligne par ligne à la proposition de votre garage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ClientQuote,
});

const CHOICES: ClientResponse[] = ["accepted", "refused", "later", "contact"];

function euro(v: number) {
  return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function ClientQuote() {
  const { token } = Route.useParams();
  const load = useServerFn(getPublicQuote);
  const respond = useServerFn(respondQuoteLine);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["public-quote", token], queryFn: () => load({ data: { token } }) });
  const data = q.data;

  async function choose(lineId: string, response: ClientResponse) {
    setBusy(lineId);
    try {
      const commentValue = comments[lineId];
      const res = await respond({
        data: {
          token,
          lineId,
          response,
          ...(commentValue ? { comment: commentValue } : {}),
        },
      });
      if (!res.ok) throw new Error(res.error);
      await q.refetch();
      toast.success("Votre réponse a bien été enregistrée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    } finally {
      setBusy(null);
    }
  }

  const lines = data?.ok ? data.lines : [];
  const kept = lines.filter((l) => l.client_response !== "refused" && !l.needs_contact);
  const total = kept.reduce((s, l) => s + Number(l.total_ttc), 0);
  const blocks: QuoteBlock[] = ["mecanique", "carrosserie", "esthetique"];

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          <div className="h-10 w-1.5 rounded-full bg-brand" aria-hidden />
          <div>
            <h1 className="text-lg font-extrabold uppercase tracking-tight">
              Votre proposition d'intervention
            </h1>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {data?.ok && data.quote.plate ? data.quote.plate : "DDA Connect"}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-5">
        {q.isLoading ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
        {data && !data.ok ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {data.error}
          </p>
        ) : null}

        {blocks.map((block) => {
          const rows = lines.filter((l) => l.block === block);
          if (!rows.length) return null;
          const sub = rows
            .filter((l) => l.client_response !== "refused" && !l.needs_contact)
            .reduce((s, l) => s + Number(l.total_ttc), 0);
          return (
            <section key={block} className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  {BLOCK_LABEL[block]}
                </h2>
                <span className="text-sm font-bold">{euro(sub)} TTC</span>
              </div>
              {rows.map((l) => (
                <article key={l.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold">{l.label}</div>
                      {l.detail ? (
                        <div className="mt-0.5 text-xs text-muted-foreground">{l.detail}</div>
                      ) : null}
                      <div className="mt-2">
                        <Badge>{PRIORITY_LABEL[(l.priority as Priority) ?? "a_prevoir"]}</Badge>
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-extrabold">
                      {l.needs_contact ? (
                        <span className="text-muted-foreground">{CONTACT_US}</span>
                      ) : (
                        `${euro(Number(l.total_ttc))} TTC`
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {CHOICES.map((c) => (
                      <button
                        key={c}
                        disabled={busy === l.id}
                        onClick={() => void choose(l.id, c)}
                        className={`rounded-lg px-3 py-3 text-xs font-bold uppercase tracking-wide ${
                          l.client_response === c
                            ? "bg-brand text-brand-foreground"
                            : "border border-border bg-card"
                        }`}
                      >
                        {RESPONSE_LABEL[c]}
                      </button>
                    ))}
                  </div>
                  <input
                    value={comments[l.id] ?? l.client_comment ?? ""}
                    onChange={(e) => setComments((s) => ({ ...s, [l.id]: e.target.value }))}
                    placeholder="Commentaire (facultatif)"
                    className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                </article>
              ))}
            </section>
          );
        })}

        {lines.length ? (
          <>
            <div className="flex items-center justify-between rounded-xl bg-secondary px-4 py-4">
              <span className="text-sm font-bold uppercase tracking-wide">Total retenu</span>
              <span className="text-lg font-extrabold">{euro(total)} TTC</span>
            </div>
            <button
              disabled
              title="Paiement en ligne à venir"
              className="w-full rounded-xl border border-dashed border-border px-4 py-4 text-sm font-bold uppercase tracking-wide text-muted-foreground"
            >
              Valider et payer — bientôt disponible
            </button>
          </>
        ) : null}
      </main>
    </div>
  );
}
